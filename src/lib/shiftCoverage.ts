import { TZDate } from '@date-fns/tz';
import { addCalendarDays, safeTimezone } from '@/lib/utils/timezone';

/**
 * Coverage maths for the Shift Calendar (CA Portal): for one account and one
 * local day, which stretches have an agent on it and which have nobody.
 *
 * Pure and synchronous. Display only — nothing here touches pay, and the salary
 * engine must never read it (ca-salary.md §14).
 *
 * "Covered" means at least one scheduled shift lists the account in
 * `creatorIds`. Two agents on the same account at once is still covered once —
 * intervals are merged, never summed. A sub-account is its own account: covering
 * the parent does not cover it (ca-salary.md, sub-accounts are peers).
 */

export const MINUTE_MS = 60_000;

export interface CoverageShift {
  userId: string;
  occurrenceStart: number;
  occurrenceEnd: number;
  creatorIds?: string[];
}

export interface Interval {
  start: number;
  end: number;
}

/** UTC ms of local midnight on `dateStr` in `tz` — DST-safe (a day can be 23 or 25h). */
export function localDayStartMs(dateStr: string, tz: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new TZDate(y, m - 1, d, 0, 0, 0, safeTimezone(tz)).getTime();
}

/** Merge overlapping or touching intervals, sorted by start. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/** The parts of [windowStart, windowEnd) that no interval in `covered` (merged) touches. */
export function gapsWithin(covered: Interval[], windowStart: number, windowEnd: number): Interval[] {
  const gaps: Interval[] = [];
  let cursor = windowStart;
  for (const iv of covered) {
    if (iv.end <= cursor) continue;
    if (iv.start >= windowEnd) break;
    if (iv.start > cursor) gaps.push({ start: cursor, end: Math.min(iv.start, windowEnd) });
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < windowEnd) gaps.push({ start: cursor, end: windowEnd });
  return gaps;
}

export interface DayCoverage {
  day: string;
  dayStart: number;
  dayEnd: number;
  /** Shifts touching this day on this account, earliest first. */
  shifts: CoverageShift[];
  covered: Interval[];
  gaps: Interval[];
  coveredMs: number;
  gapMs: number;
}

export interface AccountWeek {
  accountId: string;
  days: DayCoverage[];
  gapMs: number;
  /** Days with at least one uncovered minute. */
  gapDays: number;
}

/**
 * Index shifts by account once, so a 40-account grid does one pass over the
 * shifts rather than one per cell.
 */
export function indexShiftsByAccount(shifts: CoverageShift[]): Map<string, CoverageShift[]> {
  const map = new Map<string, CoverageShift[]>();
  for (const s of shifts) {
    for (const id of s.creatorIds ?? []) {
      const list = map.get(id);
      if (list) list.push(s);
      else map.set(id, [s]);
    }
  }
  return map;
}

export function computeAccountWeek(
  accountId: string,
  accountShifts: CoverageShift[],
  weekDays: string[],
  tz: string,
): AccountWeek {
  let gapMs = 0;
  let gapDays = 0;
  const days = weekDays.map(day => {
    const dayStart = localDayStartMs(day, tz);
    const dayEnd = localDayStartMs(addCalendarDays(day, 1), tz);

    const touching = accountShifts
      .filter(s => s.occurrenceStart < dayEnd && s.occurrenceEnd > dayStart)
      .sort((a, b) => a.occurrenceStart - b.occurrenceStart);

    const covered = mergeIntervals(
      touching.map(s => ({ start: Math.max(s.occurrenceStart, dayStart), end: Math.min(s.occurrenceEnd, dayEnd) })),
    );
    const gaps = gapsWithin(covered, dayStart, dayEnd);
    const coveredMs = covered.reduce((n, iv) => n + (iv.end - iv.start), 0);
    const dayGapMs = dayEnd - dayStart - coveredMs;
    gapMs += dayGapMs;
    if (dayGapMs >= MINUTE_MS) gapDays += 1;
    return { day, dayStart, dayEnd, shifts: touching, covered, gaps, coveredMs, gapMs: dayGapMs };
  });
  return { accountId, days, gapMs, gapDays };
}

/** "6h", "45m", "6h 30m" — whole minutes, never "0h". */
export function formatDuration(ms: number): string {
  const mins = Math.round(ms / MINUTE_MS);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
