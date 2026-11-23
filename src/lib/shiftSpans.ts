/**
 * Shift spans as one person experiences them.
 *
 * Pure, so the server (`/api/time-tracking/my-shift`, the break policy) and the
 * renderer (the time-tracking ring) agree on what "your shift" is.
 */

export interface ShiftSpan {
  /** ms UTC, inclusive */
  start: number;
  /** ms UTC, exclusive */
  end: number;
}

/**
 * Sort and merge touching or overlapping spans, so back-to-back occurrences (a
 * regular shift followed by cover) are one continuous shift — the seam between
 * them is not an end and a start.
 */
export function mergeShiftSpans(spans: ReadonlyArray<ShiftSpan>): ShiftSpan[] {
  const sorted = spans
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map(s => ({ start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start);

  const merged: ShiftSpan[] = [];
  for (const s of sorted) {
    const last = merged.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push(s);
  }
  return merged;
}

/**
 * The shift that belongs on today's clock, from merged spans:
 *   1. the one running now;
 *   2. else the next one starting before the day ends;
 *   3. else the last one that touched today (already over).
 * Null when today holds no shift at all — the page then scales to the day's own
 * activity and says nothing about a shift.
 */
export function pickTodayShift(
  spans: ReadonlyArray<ShiftSpan>,
  nowMs: number,
  dayStartMs: number,
  dayEndMs: number,
): ShiftSpan | null {
  const today = spans.filter(s => s.end > dayStartMs && s.start <= dayEndMs);
  const running = today.find(s => s.start <= nowMs && nowMs < s.end);
  if (running) return running;
  const upcoming = today.filter(s => s.start > nowMs).sort((a, b) => a.start - b.start)[0];
  if (upcoming) return upcoming;
  const past = today.filter(s => s.end <= nowMs).sort((a, b) => b.end - a.end)[0];
  return past ?? null;
}
