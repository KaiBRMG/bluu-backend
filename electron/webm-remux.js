'use strict';

/**
 * Makes a `MediaRecorder` WebM seekable and gives it a duration.
 *
 * ## What is wrong with the file
 *
 * Chromium's recorder writes a live-streaming Matroska: the Segment and every
 * Cluster carry the "unknown size" marker, `Info` has no `Duration`, and there
 * is no `SeekHead` or `Cues`. A player therefore sees an open-ended stream —
 * no end time, nowhere to scrub to, and every seek is a bisection search
 * through the file. (Confirmed against a real recording from the shipped app.)
 *
 * ## What this does
 *
 *   • appends a `Duration` to `Info`, taken from the last block's timestamp;
 *   • writes a `Cues` index (one entry per Cluster) BEFORE the first Cluster,
 *     where a progressive demuxer finds it without scanning to the end.
 *
 * Every Cluster is copied byte-for-byte. Nothing is decoded or re-encoded.
 *
 * ## Why it is shaped this way
 *
 *   • **Streaming.** Recordings run to hundreds of megabytes and main owns the
 *     event loop for every window, so the file is read through a small window
 *     and copied in chunks with async I/O — never loaded whole.
 *   • **Fixed-width encodings.** `Cues` goes in front of data it describes, so
 *     its size has to be known before any offset inside it is. Every field is
 *     therefore written at a fixed width, which makes the size a function of
 *     the cluster count alone.
 *   • **Exact shape or nothing.** It only touches a file that has no Duration,
 *     no SeekHead and no Cues, with a known layout. Anything else is returned
 *     untouched — a recording that is merely not improved is fine, a recording
 *     that is corrupted is the one thing this must never produce.
 *   • **Write beside, verify, then rename.** The result is built in a sibling
 *     file, every Cue is checked to land on a Cluster header, and only then
 *     does it replace the original (an atomic rename). Any failure — including
 *     a full disk — deletes the partial and leaves the original in place.
 *
 * It is best-effort by contract: callers treat a throw and `changed: false`
 * identically, and the recording uploads either way.
 */

const fsp = require('fs/promises');

const ID = {
  EBML: 0x1a45dfa3,
  SEGMENT: 0x18538067,
  SEEKHEAD: 0x114d9b74,
  INFO: 0x1549a966,
  TRACKS: 0x1654ae6b,
  CLUSTER: 0x1f43b675,
  CUES: 0x1c53bb6b,
  TAGS: 0x1254c367,
  ATTACHMENTS: 0x1941a469,
  CHAPTERS: 0x1043a770,
  VOID: 0xec,
  TIMECODE_SCALE: 0x2ad7b1,
  DURATION: 0x4489,
  TIMECODE: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  BLOCK_DURATION: 0x9b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  TRACK_TYPE: 0x83,
};

/** Elements that can only appear at Segment level — they end an unknown-size Cluster. */
const LEVEL1 = new Set([
  ID.CLUSTER, ID.CUES, ID.TAGS, ID.ATTACHMENTS, ID.CHAPTERS, ID.SEEKHEAD, ID.INFO, ID.TRACKS,
]);

const CUE_POINT_BYTES = 19; // BB 11 { B3 84 <4> B7 0B { F7 81 <1> F1 84 <4> } }
const CUES_HEADER_BYTES = 8; // 1C 53 BB 6B + 4-byte size
const MAX_U32 = 0xffffffff;
const COPY_CHUNK = 1024 * 1024;
const WINDOW = 64 * 1024;
/** Free space we insist on beyond the copy itself, so a full disk is never ours to cause. */
const DISK_HEADROOM = 64 * 1024 * 1024;

class Unsupported extends Error {}
const unsupported = (why) => new Unsupported(why);

// ─── EBML primitives ──────────────────────────────────────────────────

function idLength(first) {
  if (first & 0x80) return 1;
  if (first & 0x40) return 2;
  if (first & 0x20) return 3;
  if (first & 0x10) return 4;
  return 0; // not a valid element ID
}

function sizeLength(first) {
  for (let i = 0; i < 8; i++) if (first & (0x80 >> i)) return i + 1;
  return 0;
}

/** Parses an element header at `off`; null when the buffer ends inside it. */
function parseHeader(buf, off = 0) {
  if (off >= buf.length) return null;
  const idLen = idLength(buf[off]);
  if (idLen === 0) throw unsupported('invalid element id');
  if (off + idLen >= buf.length) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + buf[off + i];

  const first = buf[off + idLen];
  const sizeLen = sizeLength(first);
  if (sizeLen === 0) throw unsupported('invalid element size');
  if (off + idLen + sizeLen > buf.length) return null;

  const mask = 0xff >> sizeLen;
  let value = first & mask;
  let allOnes = value === mask;
  for (let i = 1; i < sizeLen; i++) {
    const b = buf[off + idLen + i];
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  if (!allOnes && value > Number.MAX_SAFE_INTEGER) throw unsupported('size out of range');
  return { id, idLen, sizeLen, headerLen: idLen + sizeLen, size: allOnes ? null : value };
}

function readUInt(buf) {
  let v = 0;
  for (let i = 0; i < buf.length; i++) v = v * 256 + buf[i];
  return v;
}

/** An 8-byte size field (`01 xx xx xx xx xx xx xx`) — fixed width, any value we will meet. */
function size8(n) {
  const b = Buffer.alloc(8);
  b[0] = 0x01;
  b.writeUIntBE(n, 2, 6); // top byte stays 0 — sizes here are far below 2^48
  return b;
}

function idBytes(id) {
  const len = id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1;
  const b = Buffer.alloc(len);
  for (let i = len - 1, v = id; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v & 0xff;
  return b;
}

// ─── Windowed reader ──────────────────────────────────────────────────

class Reader {
  constructor(fh, size) {
    this.fh = fh;
    this.size = size;
    this.start = 0;
    this.buf = Buffer.alloc(0);
  }

  /** Up to `len` bytes at `pos`; shorter only at end of file. */
  async slice(pos, len) {
    if (pos < 0 || pos >= this.size) return Buffer.alloc(0);
    len = Math.min(len, this.size - pos);
    if (pos >= this.start && pos + len <= this.start + this.buf.length) {
      return this.buf.subarray(pos - this.start, pos - this.start + len);
    }
    const n = Math.min(Math.max(len, WINDOW), this.size - pos);
    const b = Buffer.alloc(n);
    const { bytesRead } = await this.fh.read(b, 0, n, pos);
    this.buf = b.subarray(0, bytesRead);
    this.start = pos;
    return this.buf.subarray(0, Math.min(len, bytesRead));
  }

  async header(pos) {
    return parseHeader(await this.slice(pos, 16));
  }
}

// ─── Scanning ─────────────────────────────────────────────────────────

/** Children of a small element whose whole body is cheap to read. */
async function readChildren(reader, bodyStart, bodyEnd) {
  const out = [];
  let pos = bodyStart;
  while (pos < bodyEnd) {
    const h = await reader.header(pos);
    if (!h || h.size === null) throw unsupported('malformed child');
    const start = pos + h.headerLen;
    if (start + h.size > bodyEnd) throw unsupported('child overruns parent');
    out.push({ id: h.id, start, size: h.size });
    pos = start + h.size;
  }
  return out;
}

/** Block timing for the last frames of the stream: absolute ticks, plus any stated duration. */
async function blockEnd(reader, child, clusterTimecode) {
  if (child.id === ID.SIMPLE_BLOCK) {
    return (await blockTicks(reader, child.start, child.size, clusterTimecode)) ?? null;
  }
  if (child.id === ID.BLOCK_GROUP) {
    const kids = await readChildren(reader, child.start, child.start + child.size);
    const block = kids.find((k) => k.id === ID.BLOCK);
    if (!block) return null;
    const t = await blockTicks(reader, block.start, block.size, clusterTimecode);
    if (t === null) return null;
    const dur = kids.find((k) => k.id === ID.BLOCK_DURATION);
    const d = dur ? readUInt(await reader.slice(dur.start, dur.size)) : 0;
    return t + d;
  }
  return null;
}

async function blockTicks(reader, start, size, clusterTimecode) {
  if (size < 4) return null;
  const head = await reader.slice(start, 8);
  const trackLen = sizeLength(head[0]);
  if (trackLen === 0 || trackLen + 2 > head.length) return null;
  return clusterTimecode + head.readInt16BE(trackLen);
}

/**
 * Walks the file once and returns everything the rewrite needs.
 * Throws `Unsupported` for any shape this does not handle.
 */
async function scan(reader) {
  const fileSize = reader.size;

  const ebml = await reader.header(0);
  if (!ebml || ebml.id !== ID.EBML || ebml.size === null) throw unsupported('no EBML header');
  const segmentPos = ebml.headerLen + ebml.size;

  const seg = await reader.header(segmentPos);
  if (!seg || seg.id !== ID.SEGMENT) throw unsupported('no Segment');
  const segDataStart = segmentPos + seg.headerLen;
  const segmentKnownSize = seg.size !== null;
  const segEnd = segmentKnownSize ? Math.min(segDataStart + seg.size, fileSize) : fileSize;

  // ── Everything before the first Cluster ──
  const pre = [];
  let pos = segDataStart;
  let timecodeScale = 1000000;
  let videoTrack = 1;
  let infoIndex = -1;
  for (;;) {
    const h = await reader.header(pos);
    if (!h) throw unsupported('file ends before any Cluster');
    if (h.id === ID.CLUSTER) break;
    if (h.id === ID.SEEKHEAD || h.id === ID.CUES) throw unsupported('already indexed');
    if (h.size === null) throw unsupported('unknown-size header element');
    const bodyStart = pos + h.headerLen;
    const end = bodyStart + h.size;
    if (end > segEnd) throw unsupported('header element overruns file');

    if (h.id === ID.INFO) {
      infoIndex = pre.length;
      for (const c of await readChildren(reader, bodyStart, end)) {
        if (c.id === ID.DURATION) throw unsupported('already has a Duration');
        if (c.id === ID.TIMECODE_SCALE) {
          timecodeScale = readUInt(await reader.slice(c.start, c.size)) || timecodeScale;
        }
      }
    } else if (h.id === ID.TRACKS) {
      for (const entry of await readChildren(reader, bodyStart, end)) {
        if (entry.id !== ID.TRACK_ENTRY) continue;
        const kids = await readChildren(reader, entry.start, entry.start + entry.size);
        const type = kids.find((k) => k.id === ID.TRACK_TYPE);
        const num = kids.find((k) => k.id === ID.TRACK_NUMBER);
        if (type && num && readUInt(await reader.slice(type.start, type.size)) === 1) {
          videoTrack = readUInt(await reader.slice(num.start, num.size));
          break;
        }
      }
    }
    pre.push({ id: h.id, start: pos, end });
    pos = end;
  }
  if (infoIndex < 0) throw unsupported('no Info');
  const firstCluster = pos;

  // ── Clusters ──
  const clusters = [];
  let lastBlocks = [];
  let lastTimecode = 0;
  while (pos < segEnd) {
    const h = await reader.header(pos);
    if (!h) break; // a header cut off by the end of the file — copied as-is
    if (h.id !== ID.CLUSTER) throw unsupported('unexpected element after Clusters');

    const bodyStart = pos + h.headerLen;
    let end;
    let timecode = 0;
    let haveTimecode = false;
    const blocks = [];

    if (h.size !== null) {
      end = Math.min(bodyStart + h.size, segEnd);
    }
    let p = bodyStart;
    const limit = h.size !== null ? end : segEnd;
    for (;;) {
      if (p >= limit) {
        end = limit;
        break;
      }
      const c = await reader.header(p);
      if (!c) {
        end = limit; // truncated tail
        break;
      }
      if (h.size === null && LEVEL1.has(c.id)) {
        end = p;
        break;
      }
      if (c.size === null) throw unsupported('unknown-size cluster child');
      const cStart = p + c.headerLen;
      if (cStart + c.size > limit) {
        end = limit; // the last child was cut off
        break;
      }
      if (c.id === ID.TIMECODE && !haveTimecode) {
        timecode = readUInt(await reader.slice(cStart, c.size));
        haveTimecode = true;
      } else if (c.id === ID.SIMPLE_BLOCK || c.id === ID.BLOCK_GROUP) {
        blocks.push({ id: c.id, start: cStart, size: c.size });
        if (blocks.length > 4) blocks.shift();
      }
      p = cStart + c.size;
    }

    if (!haveTimecode) throw unsupported('Cluster without a Timecode');
    clusters.push({ start: pos, timecode });
    lastBlocks = blocks;
    lastTimecode = timecode;
    pos = end;
  }
  if (clusters.length === 0) throw unsupported('no complete Cluster');

  // The stream's true end: the latest of the last few blocks (audio and video
  // interleave, so the final one is not necessarily the latest).
  let endTicks = lastTimecode;
  for (const block of lastBlocks) {
    const t = await blockEnd(reader, block, lastTimecode);
    if (t !== null && t > endTicks) endTicks = t;
  }

  return {
    segmentPos,
    segmentHeaderLen: seg.headerLen,
    segmentKnownSize,
    segSize: seg.size,
    segDataStart,
    pre,
    infoIndex,
    firstCluster,
    clustersEnd: pos,
    clusters,
    timecodeScale,
    videoTrack,
    endTicks,
  };
}

// ─── Building the pieces ──────────────────────────────────────────────

function buildCues(layout, delta) {
  const body = Buffer.alloc(layout.clusters.length * CUE_POINT_BYTES);
  let o = 0;
  for (const cluster of layout.clusters) {
    const position = cluster.start - layout.segDataStart + delta;
    if (position > MAX_U32 || cluster.timecode > MAX_U32) throw unsupported('offset out of range');
    // CuePoint
    body[o++] = 0xbb; body[o++] = 0x11;
    //   CueTime
    body[o++] = 0xb3; body[o++] = 0x84;
    body.writeUInt32BE(cluster.timecode, o); o += 4;
    //   CueTrackPositions
    body[o++] = 0xb7; body[o++] = 0x0b;
    //     CueTrack
    body[o++] = 0xf7; body[o++] = 0x81; body[o++] = layout.videoTrack & 0xff;
    //     CueClusterPosition
    body[o++] = 0xf1; body[o++] = 0x84;
    body.writeUInt32BE(position, o); o += 4;
  }
  const head = Buffer.alloc(CUES_HEADER_BYTES);
  head.writeUInt32BE(ID.CUES, 0);
  head.writeUInt32BE((0x10000000 | body.length) >>> 0, 4); // 4-byte size vint
  return Buffer.concat([head, body]);
}

function buildInfo(layout, infoBody) {
  const duration = Buffer.alloc(11);
  duration[0] = 0x44; duration[1] = 0x89; duration[2] = 0x88;
  // One frame past the last block, so the final frame is reachable.
  const frameTicks = Math.max(1, Math.round(1000 / 30 / (layout.timecodeScale / 1e6)));
  duration.writeDoubleBE(layout.endTicks + frameTicks, 3);
  const body = Buffer.concat([infoBody, duration]);
  return Buffer.concat([idBytes(ID.INFO), size8(body.length), body]);
}

// ─── Public entry ─────────────────────────────────────────────────────

async function copyRange(src, out, start, end) {
  const buf = Buffer.alloc(COPY_CHUNK);
  let pos = start;
  while (pos < end) {
    const want = Math.min(COPY_CHUNK, end - pos);
    const { bytesRead } = await src.read(buf, 0, want, pos);
    if (bytesRead <= 0) throw new Error('short read while copying');
    await out.write(buf, 0, bytesRead);
    pos += bytesRead;
  }
}

/**
 * Remuxes `filePath` in place. Resolves `{ changed, ... }`; never leaves a
 * partial file behind. `changed: false` carries a `reason` and means the
 * original is exactly as it was.
 */
async function remuxWebm(filePath) {
  const tempPath = `${filePath}.remux`;
  let src = null;
  let out = null;
  try {
    src = await fsp.open(filePath, 'r');
    const { size } = await src.stat();
    if (size < 64) return { changed: false, reason: 'too small' };

    // Refuse before writing anything if the copy could fill the disk.
    try {
      const fsStats = await fsp.statfs(filePath);
      if (fsStats.bavail * fsStats.bsize < size + DISK_HEADROOM) {
        return { changed: false, reason: 'not enough free disk space' };
      }
    } catch { /* statfs is advisory — a write failure below is still handled */ }

    const layout = await scan(new Reader(src, size));

    // Rebuilt pieces. Their sizes decide every offset after them.
    const infoEntry = layout.pre[layout.infoIndex];
    const infoHeader = parseHeader(await new Reader(src, size).slice(infoEntry.start, 16));
    const infoBodyStart = infoEntry.start + infoHeader.headerLen;
    const infoBody = Buffer.alloc(infoEntry.end - infoBodyStart);
    await src.read(infoBody, 0, infoBody.length, infoBodyStart);
    const newInfo = buildInfo(layout, infoBody);
    const oldInfoLen = infoEntry.end - infoEntry.start;

    const cuesLen = CUES_HEADER_BYTES + layout.clusters.length * CUE_POINT_BYTES;
    const delta = newInfo.length - oldInfoLen + cuesLen;
    const cues = buildCues(layout, delta);

    // A Segment with a stated size has to state the new one.
    let segmentHeader;
    if (layout.segmentKnownSize) {
      segmentHeader = Buffer.concat([idBytes(ID.SEGMENT), size8(layout.segSize + delta)]);
    } else {
      segmentHeader = Buffer.alloc(layout.segmentHeaderLen);
      await src.read(segmentHeader, 0, segmentHeader.length, layout.segmentPos);
    }

    out = await fsp.open(tempPath, 'w');
    await copyRange(src, out, 0, layout.segmentPos); // EBML header
    await out.write(segmentHeader);
    for (let i = 0; i < layout.pre.length; i++) {
      if (i === layout.infoIndex) await out.write(newInfo);
      else await copyRange(src, out, layout.pre[i].start, layout.pre[i].end);
    }
    await out.write(cues);
    // Clusters verbatim — plus whatever trails the last whole one (a truncated
    // final Cluster from a crash is still playable up to where it stops).
    await copyRange(src, out, layout.firstCluster, size);
    await out.close();
    out = null;

    const cuesPos = layout.firstCluster + (newInfo.length - oldInfoLen);
    await verify(tempPath, layout, delta, size, cuesPos);
    await fsp.rename(tempPath, filePath);

    const after = await fsp.stat(filePath);
    return {
      changed: true,
      bytes: after.size,
      clusters: layout.clusters.length,
      durationMs: Math.round(((layout.endTicks) * layout.timecodeScale) / 1e6),
    };
  } catch (err) {
    if (err instanceof Unsupported) return { changed: false, reason: err.message };
    throw err;
  } finally {
    if (out) await out.close().catch(() => {});
    if (src) await src.close().catch(() => {});
    // Present only if we failed before the rename.
    await fsp.unlink(tempPath).catch(() => {});
  }
}

/**
 * The output must be the right length, and the Cues written into it must — read
 * back from the file, not recomputed — each point at a Cluster header.
 */
async function verify(tempPath, layout, delta, originalSize, cuesPos) {
  const fh = await fsp.open(tempPath, 'r');
  try {
    const { size } = await fh.stat();
    if (size !== originalSize + delta) throw new Error('remux produced an unexpected length');

    const head = Buffer.alloc(CUES_HEADER_BYTES);
    await fh.read(head, 0, head.length, cuesPos);
    if (head.readUInt32BE(0) !== ID.CUES) throw new Error('remux misplaced the Cues');
    const count = layout.clusters.length;
    if ((head.readUInt32BE(4) & 0x0fffffff) !== count * CUE_POINT_BYTES) {
      throw new Error('remux wrote Cues of the wrong size');
    }

    const body = Buffer.alloc(count * CUE_POINT_BYTES);
    await fh.read(body, 0, body.length, cuesPos + CUES_HEADER_BYTES);
    const probe = Buffer.alloc(4);
    for (let i = 0; i < count; i++) {
      const point = i * CUE_POINT_BYTES;
      const position = body.readUInt32BE(point + 15);
      await fh.read(probe, 0, 4, layout.segDataStart + position);
      if (probe.readUInt32BE(0) !== ID.CLUSTER) throw new Error('a Cue does not land on a Cluster');
    }
  } finally {
    await fh.close().catch(() => {});
  }
}

module.exports = { remuxWebm, _internal: { scan, Reader, parseHeader } };
