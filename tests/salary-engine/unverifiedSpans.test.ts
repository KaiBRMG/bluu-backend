/**
 * Unverified working spans.
 *
 * ## The regression this exists for
 *
 * An agent's shift ended at 15:00. The last screenshot was 14:58, the next
 * 19:26, and they clocked out at 19:27 — and the ledger credited the whole
 * 4.5h as working. The machine had slept without the renderer hearing
 * `suspend`, the screenshot timer fired the moment it woke, and they clocked
 * out before the 15-min heartbeat could run its sleep-gap check. Nothing in the
 * log between 14:58 and 19:26 said the app was running, yet it all counted.
 *
 * `excludeUnverifiedSpans` is the server-side rule that closes that: working
 * time needs evidence (heartbeat, screenshot or transition) at least every
 * UNVERIFIED_GAP_MS. These tests pin it through `parseBuffer` — the figure the
 * ledger stores and `computeTimeWorked` (payroll) reads.
 */

import { excludeUnverifiedSpans, UNVERIFIED_GAP_MS, UNVERIFIED_TRIGGER } from '@/lib/unverifiedSpans';
import { parseBuffer } from '@/lib/parseBuffer';
import type { SessionEvent } from '@/types/firestore';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 19, 6, 0); // 08:00 SAST
const at = (minutes: number) => T0 + minutes * MIN;

function worked(events: SessionEvent[]): number {
  const { events: corrected } = excludeUnverifiedSpans(events);
  return parseBuffer(corrected).workingSeconds;
}

describe('excludeUnverifiedSpans', () => {
  it('reproduces the reported shift: the silent 14:58 → 19:26 stretch stops counting', () => {
    // Clocked in 08:00, heartbeats every 15 min until a screenshot at 14:58
    // (06:58 after T0 = 418 min), then nothing until 19:26 (686 min).
    const events: SessionEvent[] = [{ type: 'clock-in', timestamp: at(0) }];
    for (let m = 15; m <= 405; m += 15) events.push({ type: 'activity', timestamp: at(m) });
    events.push({ type: 'screenshot', timestamp: at(418) });
    events.push({ type: 'screenshot', timestamp: at(686) });
    events.push({ type: 'clock-out', timestamp: at(687) });

    const { unverifiedSeconds } = excludeUnverifiedSpans(events);
    // 418 min verified + 1s up to the synthetic pause, + the 1 min after waking.
    expect(worked(events)).toBe(418 * 60 + 1 + 60);
    expect(unverifiedSeconds).toBe((686 - 418) * 60 - 1);
  });

  it('leaves a healthy session untouched — same array, nothing removed', () => {
    const events: SessionEvent[] = [
      { type: 'clock-in', timestamp: at(0) },
      { type: 'activity', timestamp: at(15) },
      { type: 'screenshot', timestamp: at(22) },
      { type: 'activity', timestamp: at(30) },
      { type: 'clock-out', timestamp: at(40) },
    ];
    const result = excludeUnverifiedSpans(events);
    expect(result.events).toBe(events);
    expect(result.unverifiedSeconds).toBe(0);
  });

  it('accepts a gap exactly at the threshold and trims one just past it', () => {
    const exact: SessionEvent[] = [
      { type: 'clock-in', timestamp: T0 },
      { type: 'clock-out', timestamp: T0 + UNVERIFIED_GAP_MS },
    ];
    expect(excludeUnverifiedSpans(exact).unverifiedSeconds).toBe(0);

    const over: SessionEvent[] = [
      { type: 'clock-in', timestamp: T0 },
      { type: 'clock-out', timestamp: T0 + UNVERIFIED_GAP_MS + 1000 },
    ];
    expect(excludeUnverifiedSpans(over).unverifiedSeconds).toBeGreaterThan(0);
  });

  it('never touches idle, break or pause — they write no heartbeats by design', () => {
    const events: SessionEvent[] = [
      { type: 'clock-in', timestamp: at(0) },
      { type: 'idle-start', timestamp: at(10) },
      { type: 'idle-end', timestamp: at(120) },
      { type: 'break-start', timestamp: at(125) },
      { type: 'break-end', timestamp: at(170) },
      { type: 'pause', timestamp: at(175) },
      { type: 'resume', timestamp: at(300) },
      { type: 'clock-out', timestamp: at(305) },
    ];
    expect(excludeUnverifiedSpans(events).unverifiedSeconds).toBe(0);
  });

  it('closes the pause before a following idle span, so idle is not double-counted', () => {
    const events: SessionEvent[] = [
      { type: 'clock-in', timestamp: at(0) },
      { type: 'idle-start', timestamp: at(60) }, // a 60-min silent working span
      { type: 'idle-end', timestamp: at(70) },
      { type: 'clock-out', timestamp: at(75) },
    ];
    const { events: corrected } = excludeUnverifiedSpans(events);
    const totals = parseBuffer(corrected);
    expect(totals.idleSeconds).toBe(10 * 60);
    expect(totals.workingSeconds).toBe(1 + 5 * 60);
    expect(corrected.filter(e => e.meta?.trigger === UNVERIFIED_TRIGGER)).toHaveLength(2);
  });

  it('keeps a gap the renderer proved the machine was awake through', () => {
    const events: SessionEvent[] = [
      { type: 'clock-in', timestamp: at(0) },
      { type: 'activity', timestamp: at(30), meta: { awakeVerified: true } },
      { type: 'clock-out', timestamp: at(35) },
    ];
    expect(excludeUnverifiedSpans(events).unverifiedSeconds).toBe(0);
    expect(worked(events)).toBe(35 * 60);
  });

  it('is idempotent — a corrected log is returned unchanged', () => {
    const events: SessionEvent[] = [
      { type: 'clock-in', timestamp: at(0) },
      { type: 'screenshot', timestamp: at(100) },
      { type: 'clock-out', timestamp: at(101) },
    ];
    const once = excludeUnverifiedSpans(events).events;
    const twice = excludeUnverifiedSpans(once);
    expect(twice.events).toBe(once);
    expect(twice.unverifiedSeconds).toBe(0);
  });

  it('does not re-trim a gap the renderer already patched as sleep', () => {
    const events: SessionEvent[] = [
      { type: 'clock-in', timestamp: at(0) },
      { type: 'activity', timestamp: at(15) },
      { type: 'pause', timestamp: at(15) + 1000, meta: { trigger: 'sleep-gap' } },
      { type: 'resume', timestamp: at(200), meta: { trigger: 'sleep-gap' } },
      { type: 'clock-out', timestamp: at(210) },
    ];
    expect(excludeUnverifiedSpans(events).unverifiedSeconds).toBe(0);
  });
});
