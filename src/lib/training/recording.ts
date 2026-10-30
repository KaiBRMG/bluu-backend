/**
 * The screen recording of a training attempt — limits and pure helpers shared
 * by the candidate's browser, the API and the admin player. Free of
 * `server-only` and of anything heavy, like `modules.ts`.
 *
 * The recording is a run of short, independently playable video files
 * ("segments"), each PUT straight to Storage over a server-signed URL. A
 * segment's object name carries a zero-padded sequence number the server
 * allocates, so lexical order is time order and nothing can overwrite another.
 */

/** Length of one segment. Also roughly how far behind live the admin is. */
export const SEGMENT_MS = 10_000;

/** Segment URLs signed per request — one call a minute, not one per segment (rule 9i). */
export const SEGMENT_BATCH = 6;

/** A signed segment URL lives this long at most (and never past `deadline + grace`). */
export const SEGMENT_URL_TTL_MS = 5 * 60_000;

/** Upper bound on segments one attempt may ever be signed, reopens included. */
export const MAX_SEGMENTS_PER_ATTEMPT = 1000;

/**
 * Edit uploads are refused while the newest segment is older than this — the
 * server's half of "the test locks while the screen is not shared". Generous on
 * purpose: segments share the candidate's line with their edit uploads, and a
 * slow line must not lock an honest candidate out.
 */
export const RECORDING_STALE_MS = 90_000;

/** A screen check counts for Start for this long. */
export const SCREEN_CHECK_TTL_MS = 10 * 60_000;
/** The browser refreshes its check frame before Start once it is this old. */
export const SCREEN_CHECK_REFRESH_MS = 8 * 60_000;
/** Check frames one candidate may upload per part. */
export const MAX_SCREEN_CHECKS = 50;
export const MAX_CHECK_BYTES = 3 * 1024 * 1024;

/**
 * Capture settings: a readable screen, not a cinema one. Bitrate sets how fast Storage grows.
 * 10 fps (was 5) so a reviewer sees the cursor and windows move rather than jump; the bitrate
 * rose with it, so roughly 50% more Storage per minute than before.
 */
export const CAPTURE_MAX_WIDTH = 1920;
export const CAPTURE_MAX_HEIGHT = 1200;
export const CAPTURE_FRAME_RATE = 10;
export const CAPTURE_BITS_PER_SECOND = 1_200_000;

/** The container types a segment may be, and the extension it is stored under. */
export const RECORDING_TYPES = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
} as const;
export type RecordingType = keyof typeof RECORDING_TYPES;

export function isRecordingType(value: unknown): value is RecordingType {
  return typeof value === 'string' && value in RECORDING_TYPES;
}

/** `seg-000042.webm` — zero-padded so the bucket's lexical order is the recording's order. */
export function segmentName(seq: number, type: RecordingType): string {
  return `seg-${String(seq).padStart(6, '0')}.${RECORDING_TYPES[type]}`;
}

export function parseSegmentName(name: string): number | null {
  const m = /seg-(\d{6})\.(webm|mp4)$/.exec(name);
  return m ? Number(m[1]) : null;
}

export interface SegmentLike {
  seq: number;
  /** When the segment finished uploading — the server's clock, from Storage. */
  endedAtMs: number;
}

/** Two segments further apart than this have a gap between them; closer is upload jitter. */
const GAP_SLACK_MS = SEGMENT_MS * 2.5;

/**
 * Stretches of the attempt with no recording: before the first segment, between
 * two that are further apart than a segment and a bit, and after the last one.
 * Derived on read from the segment times; nothing stores a gap.
 *
 * `resumedAtMs` is a reopen: the time between the first run and it was not part
 * of the attempt, so it is not a gap. (A first run that stopped recording before
 * its own end is then not shown either — its end is not known here.)
 */
export function recordingGaps(
  segments: SegmentLike[],
  startedAtMs: number,
  endMs: number,
  resumedAtMs?: number | null,
): { fromMs: number; toMs: number }[] {
  const gaps: { fromMs: number; toMs: number }[] = [];
  let cursor = startedAtMs;
  let resumed = !resumedAtMs;
  const step = (until: number) => {
    if (!resumed && resumedAtMs! <= until) {
      cursor = Math.max(cursor, resumedAtMs!);
      resumed = true;
    }
  };
  for (const s of segments) {
    const began = s.endedAtMs - SEGMENT_MS;
    step(began);
    if (began - cursor > GAP_SLACK_MS) gaps.push({ fromMs: cursor, toMs: began });
    cursor = Math.max(cursor, s.endedAtMs);
  }
  step(endMs);
  if (endMs - cursor > GAP_SLACK_MS) gaps.push({ fromMs: cursor, toMs: endMs });
  return gaps;
}

/** The stretches that ARE recorded: runs of segments with no gap between them. */
export function recordedSpans(segments: SegmentLike[]): { fromMs: number; toMs: number }[] {
  const spans: { fromMs: number; toMs: number }[] = [];
  for (const s of segments) {
    const began = s.endedAtMs - SEGMENT_MS;
    const last = spans.at(-1);
    if (last && began - last.toMs <= GAP_SLACK_MS) last.toMs = Math.max(last.toMs, s.endedAtMs);
    else spans.push({ fromMs: began, toMs: s.endedAtMs });
  }
  return spans;
}
