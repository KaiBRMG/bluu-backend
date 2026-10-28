/**
 * Training screen recording — the pure helpers (`src/lib/training/recording.ts`).
 *
 * What these pin: segment names sort lexically in sequence order (the admin
 * player's `after` cursor and Storage's `startOffset` both rely on it), names
 * round-trip, and gaps are derived from segment times — before the first, between
 * two that are too far apart, and after the last — with a segment's normal
 * spacing never reported as one.
 */

import { SEGMENT_MS, parseSegmentName, recordedSpans, recordingGaps, segmentName } from '@/lib/training/recording';

describe('segment names', () => {
  it('sort lexically in sequence order', () => {
    const seqs = [0, 1, 9, 10, 99, 100, 999, 1000];
    const names = seqs.map((n) => segmentName(n, 'video/webm'));
    expect([...names].sort()).toEqual(names);
  });

  it('round-trip through the parser, for both containers', () => {
    expect(parseSegmentName(`a/b/${segmentName(42, 'video/webm')}`)).toBe(42);
    expect(parseSegmentName(segmentName(7, 'video/mp4'))).toBe(7);
    expect(parseSegmentName('a/b/check-abc.jpg')).toBeNull();
  });
});

describe('recordingGaps', () => {
  const start = 1_000_000;
  /** Segments ending every SEGMENT_MS from `from`, `count` of them. */
  const run = (from: number, count: number, firstSeq = 0) =>
    Array.from({ length: count }, (_, i) => ({ seq: firstSeq + i, endedAtMs: from + (i + 1) * SEGMENT_MS }));

  it('reports nothing for an unbroken recording', () => {
    const segs = run(start, 12);
    expect(recordingGaps(segs, start, segs.at(-1)!.endedAtMs)).toEqual([]);
  });

  it('tolerates upload jitter between neighbouring segments', () => {
    const segs = run(start, 6).map((s, i) => ({ ...s, endedAtMs: s.endedAtMs + (i % 2 ? 4_000 : 0) }));
    expect(recordingGaps(segs, start, segs.at(-1)!.endedAtMs)).toEqual([]);
  });

  it('finds a stretch where sharing stopped', () => {
    const before = run(start, 6);
    const resumeAt = before.at(-1)!.endedAtMs + 120_000;
    const after = run(resumeAt, 6, 6);
    const gaps = recordingGaps([...before, ...after], start, after.at(-1)!.endedAtMs);
    expect(gaps).toEqual([{ fromMs: before.at(-1)!.endedAtMs, toMs: resumeAt }]);
  });

  it('reports a recording that started late and one that stopped early', () => {
    const segs = run(start + 60_000, 3);
    const end = segs.at(-1)!.endedAtMs + 90_000;
    expect(recordingGaps(segs, start, end)).toEqual([
      { fromMs: start, toMs: start + 60_000 },
      { fromMs: segs.at(-1)!.endedAtMs, toMs: end },
    ]);
  });
});

describe('recordingGaps across a reopen', () => {
  const start = 1_000_000;
  const run = (from: number, count: number, firstSeq = 0) =>
    Array.from({ length: count }, (_, i) => ({ seq: firstSeq + i, endedAtMs: from + (i + 1) * SEGMENT_MS }));

  it('does not report the time between the first run and the reopen', () => {
    const first = run(start, 6);
    const reopenedAt = first.at(-1)!.endedAtMs + 3_600_000;
    const second = run(reopenedAt, 6, 6);
    expect(recordingGaps([...first, ...second], start, second.at(-1)!.endedAtMs, reopenedAt)).toEqual([]);
  });

  it('still reports a gap inside the reopened run', () => {
    const first = run(start, 3);
    const reopenedAt = first.at(-1)!.endedAtMs + 3_600_000;
    const second = run(reopenedAt + 120_000, 3, 3);
    expect(recordingGaps([...first, ...second], start, second.at(-1)!.endedAtMs, reopenedAt)).toEqual([
      { fromMs: reopenedAt, toMs: reopenedAt + 120_000 },
    ]);
  });
});

describe('recordedSpans', () => {
  it('merges neighbouring segments and splits at a gap', () => {
    const segs = [
      { seq: 0, endedAtMs: 20_000 },
      { seq: 1, endedAtMs: 30_000 },
      { seq: 2, endedAtMs: 200_000 },
    ];
    expect(recordedSpans(segs)).toEqual([
      { fromMs: 10_000, toMs: 30_000 },
      { fromMs: 190_000, toMs: 200_000 },
    ]);
  });
});
