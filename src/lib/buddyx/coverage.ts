/**
 * Time-tracking spans against BuddyX's hourly grid — the arithmetic behind the
 * agent report's shift table and minute timeline. Pure; the read models feed
 * it Firestore data.
 *
 * **Working, not worked.** Bluu's "worked" time includes breaks (that is what
 * pays); these spans keep the states apart, so a break is never read as
 * working time.
 *
 * Coverage (BuddyX online ÷ clocked) used to live here and was retired on
 * 2026-10-14: BuddyX online time always matched clocked time, so the ratio
 * carried no signal. Chatter Analytics now leads with sales.
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
 * than any real shift; one constant so every ledger read sees the same set.
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
