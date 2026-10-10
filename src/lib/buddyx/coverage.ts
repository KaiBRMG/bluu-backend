/**
 * Coverage — how much of an agent's clocked working time they were actually
 * online in BuddyX. Pure; the read model feeds it Firestore data.
 *
 * **Online only counts while clocked in.** Per hour, the credited online time
 * is `min(BuddyX online, Bluu working)`, summed over the period. An agent who
 * clocks 8h but is online for 4 of them, plus 4 more after clocking out, reads
 * 50% — not 100%. Hourly is the finest grain BuddyX gives (one overview call
 * per hour, `buddyx-team-hours`); inside an hour the min() is an upper bound.
 *
 * **Working, not worked.** Bluu's "worked" time includes breaks (that is what
 * pays); coverage uses working segments only, because an agent on a break is
 * correctly offline in BuddyX and would otherwise lose ~9% for it.
 *
 * Display only — none of this feeds the salary engine (rule 9f).
 */
import { dayKeyRange, toDayKey, type SalaryDayKey } from '../salary/salaryDate';
import { eventsToSegments, type SegmentState } from '../utils/sessionSegments';
import type { ActiveSessionDocument, TimeEntryLedgerDocument } from '@/types/firestore';

export const HOUR_MS = 3_600_000;

/**
 * How far before a window the time ledger is read. `getLedgerEntriesForUsers`
 * filters on `startTime`, so a session that started before the window but
 * runs into it is only found if the read reaches back to its start. Longer
 * than any real shift; one constant so every coverage read sees the same set.
 */
export const LEDGER_LOOKBACK_MS = 16 * HOUR_MS;

/**
 * Where an hour lives in `buddyx-team-hours`: its salary day and its index
 * (`'0'`–`'23'`) from that day's start. The sync writes with this and every
 * reader looks up with it — the one definition of the doc's keying.
 */
export function hourKey(hourStartMs: number): { day: SalaryDayKey; index: string } {
  const day = toDayKey(hourStartMs);
  return { day, index: String(Math.round((hourStartMs - dayKeyRange(day)[0]) / HOUR_MS)) };
}
/** A coverage ratio below this flags the agent. */
export const COVERAGE_FLAG_RATIO = 0.7;
/** Below this the flag is high severity. */
export const COVERAGE_HIGH_RATIO = 0.5;
/** Fewer clocked hours than this is too little to judge a ratio on. */
export const COVERAGE_MIN_CLOCKED_MS = 2 * HOUR_MS;

/**
 * Every tracked state span, clipped to the window. A session with no event log
 * counts as working throughout — the same rule `computeWorkedInWindow`
 * applies — and an open session counts as working from its start to now (no
 * event log exists server-side until it closes).
 */
export function sessionSpans(
  entries: TimeEntryLedgerDocument[],
  active: ActiveSessionDocument | undefined,
  windowStart: number,
  windowEnd: number,
  now: number,
): Array<{ startMs: number; endMs: number; state: SegmentState }> {
  const out: Array<{ startMs: number; endMs: number; state: SegmentState }> = [];
  const push = (a: number, b: number, state: SegmentState) => {
    const s = Math.max(a, windowStart);
    const e = Math.min(b, windowEnd);
    if (e > s) out.push({ startMs: s, endMs: e, state });
  };
  for (const entry of entries) {
    const start = entry.startTime.toMillis();
    const end = entry.endTime.toMillis();
    if (end <= windowStart || start >= windowEnd) continue;
    if (!entry.eventLog || entry.eventLog.length === 0) {
      push(start, end, 'working');
      continue;
    }
    for (const seg of eventsToSegments(entry.eventLog, start, end)) push(seg.startMs, seg.endMs, seg.state);
  }
  if (active && !active.userClockOut) push(active.startTime.toMillis(), Math.min(now, windowEnd), 'working');
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** `[startMs, endMs]` spans in the **working** state — see `sessionSpans`. */
export function workingSpans(
  entries: TimeEntryLedgerDocument[],
  active: ActiveSessionDocument | undefined,
  windowStart: number,
  windowEnd: number,
  now: number,
): Array<[number, number]> {
  return sessionSpans(entries, active, windowStart, windowEnd, now)
    .filter(s => s.state === 'working')
    .map(s => [s.startMs, s.endMs]);
}

/** Working milliseconds per hour (keyed by the hour's start), from spans. */
export function msPerHour(spans: Array<[number, number]>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [s, e] of spans) {
    for (let h = Math.floor(s / HOUR_MS) * HOUR_MS; h < e; h += HOUR_MS) {
      const ms = Math.min(e, h + HOUR_MS) - Math.max(s, h);
      if (ms > 0) out.set(h, (out.get(h) ?? 0) + ms);
    }
  }
  return out;
}

export interface CoverageFigures {
  /** Bluu working time (breaks, idle and pause excluded). */
  clockedMs: number;
  /** All BuddyX online time in the period, clocked in or not. */
  onlineMs: number;
  /** BuddyX online time that fell inside clocked working time. */
  onlineWhileClockedMs: number;
  /** `onlineWhileClocked ÷ clocked`; null with no clocked time. */
  ratio: number | null;
  /** Days with no hourly BuddyX data, judged on day totals (an upper bound). */
  approximateDays: number;
}

export interface CoverageDay {
  day: string;
  clockedMs: number;
  onlineMs: number;
  onlineWhileClockedMs: number;
}

/**
 * Coverage over a set of days. `onlineByHour` is the agent's BuddyX online
 * time per hour for days that have hourly data; `dayOnline` is the day total
 * for days that do not (judged as `min(day online, day working)`).
 */
export function coverageFor(params: {
  days: Array<{ day: string; start: number; end: number; hasHours: boolean; dayOnlineMs: number }>;
  workingByHour: Map<number, number>;
  onlineByHour: Map<number, number>;
}): CoverageFigures & { byDay: CoverageDay[] } {
  const byDay: CoverageDay[] = [];
  let clocked = 0;
  let online = 0;
  let overlap = 0;
  let approximateDays = 0;
  for (const day of params.days) {
    let dayClocked = 0;
    let dayOnline = 0;
    let dayOverlap = 0;
    for (let h = day.start; h < day.end; h += HOUR_MS) {
      const w = params.workingByHour.get(h) ?? 0;
      dayClocked += w;
      if (day.hasHours) {
        const o = Math.min(HOUR_MS, params.onlineByHour.get(h) ?? 0);
        dayOnline += o;
        dayOverlap += Math.min(o, w);
      }
    }
    if (!day.hasHours) {
      dayOnline = day.dayOnlineMs;
      dayOverlap = Math.min(dayOnline, dayClocked);
      if (dayClocked > 0 || dayOnline > 0) approximateDays += 1;
    }
    clocked += dayClocked;
    online += dayOnline;
    overlap += dayOverlap;
    byDay.push({ day: day.day, clockedMs: dayClocked, onlineMs: dayOnline, onlineWhileClockedMs: dayOverlap });
  }
  return {
    byDay,
    clockedMs: clocked,
    onlineMs: online,
    onlineWhileClockedMs: overlap,
    ratio: clocked > 0 ? Math.round((overlap / clocked) * 1000) / 1000 : null,
    approximateDays,
  };
}
