import { buildSegments, totalsByKind } from '@/lib/timesheet/daySegments';
import { excludeUnverifiedSpans } from '@/lib/unverifiedSpans';
import type { SessionEvent } from '@/types/firestore';

const M = 60_000;
const T0 = Date.UTC(2026, 10, 23, 9, 0);
const at = (min: number) => T0 + min * M;
const ev = (type: SessionEvent['type'], min: number, meta?: Record<string, unknown>): SessionEvent =>
  ({ type, timestamp: at(min), ...(meta ? { meta } : {}) });

/** Heartbeats every 10 min across [from, to) — the evidence a working span leaves. */
const beats = (from: number, to: number) =>
  Array.from({ length: Math.ceil((to - from) / 10) }, (_, i) => ev('activity', from + i * 10)).filter(e => e.timestamp < at(to));

function run(events: SessionEvent[], closeMin: number) {
  const fixed = excludeUnverifiedSpans(events).events;
  return buildSegments(fixed, at(closeMin));
}

describe('daySegments — a pause the person chose', () => {
  test('a closed user pause is Paused, never Not counted', () => {
    const segs = run([
      ev('clock-in', 0), ...beats(0, 60),
      ev('pause', 60, { trigger: 'user' }),
      ev('resume', 120, { trigger: 'user' }), ...beats(120, 180),
      ev('clock-out', 180),
    ], 180);
    const t = totalsByKind(segs);
    expect(t.pause).toBe(60 * 60);
    expect(t['not-counted']).toBe(0);
  });

  test('a live (still open) user pause is Paused', () => {
    const segs = run([ev('clock-in', 0), ...beats(0, 60), ev('pause', 60, { trigger: 'user' })], 150);
    const t = totalsByKind(segs);
    expect(t.pause).toBe(90 * 60);
    expect(t['not-counted']).toBe(0);
  });

  test('a user pause after an earlier no-evidence gap stays Paused', () => {
    const segs = run([
      ev('clock-in', 0), ev('activity', 5),
      // 40-min silent working gap → excluded as not counted
      ev('activity', 45), ...beats(45, 90),
      ev('pause', 90, { trigger: 'user' }),
      ev('resume', 150, { trigger: 'user' }),
      ev('clock-out', 160),
    ], 160);
    const t = totalsByKind(segs);
    expect(t.pause).toBe(60 * 60);
    expect(t['not-counted']).toBeGreaterThan(0);
    expect(t['not-counted']).toBeLessThan(41 * 60);
  });

  test('a legacy untagged pause is Paused', () => {
    const t = totalsByKind(run([ev('clock-in', 0), ev('pause', 10), ev('resume', 40), ev('clock-out', 50)], 50));
    expect(t.pause).toBe(30 * 60);
    expect(t['not-counted']).toBe(0);
  });

  test('sleep-gap and no-evidence pairs are Not counted', () => {
    const t = totalsByKind(run([
      ev('clock-in', 0), ev('activity', 10),
      ev('pause', 11, { trigger: 'sleep-gap' }), ev('resume', 70, { trigger: 'sleep-gap' }),
      ev('clock-out', 75),
    ], 75));
    expect(t['not-counted']).toBe(59 * 60);
    expect(t.pause).toBe(0);
  });
});
