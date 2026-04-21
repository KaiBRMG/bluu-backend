/**
 * DST-safe recurrence expansion utility.
 *
 * Shifts are stored with a wall-clock time ("09:00") and an IANA timezone
 * ("America/New_York"). When expanding recurrence, each candidate date is
 * combined with the wall-clock time and converted to UTC — so a "09:00 NY"
 * shift stays at 09:00 wall-clock time year-round even across DST transitions.
 *
 * Uses @date-fns/tz for accurate wall-clock→UTC conversion.
 */

import { TZDate } from '@date-fns/tz';
import type { ShiftRecurrence } from '@/types/firestore';
import { toLocalDateStr, addCalendarDays } from '@/lib/utils/timezone';

// ─── Wire types (from API response — Timestamps serialised to ISO strings) ───

export interface RawApiShift {
  shiftId: string;
  userId: string;
  startTime: string;           // ISO UTC
  endTime: string;             // ISO UTC
  wallClockStart: string;      // "HH:mm"
  wallClockEnd: string;        // "HH:mm"
  userTimezone: string;        // IANA e.g. "America/New_York"
  isRecurring: boolean;
  recurrence: ShiftRecurrence | null;
  seriesId: string | null;
  overrideDate: string | null; // ISO UTC midnight of overridden date
  isDeleted: boolean;
  // Attendance / time-worked (pre-computed server-side for past shifts)
  timeWorkedSeconds: number | null;
  attendanceStatus: 'on-time' | 'late' | 'absent' | null;
  // Leave request for this shift occurrence (pre-fetched server-side)
  leaveRequest?: { leaveId: string; leaveType: 'paid' | 'unpaid'; status: 'pending' | 'approved' | 'denied'; } | null;
}

export interface ExpandedShift extends RawApiShift {
  occurrenceStart: number;   // ms UTC — this specific occurrence's start
  occurrenceEnd: number;     // ms UTC — this specific occurrence's end
  isOccurrence: boolean;     // true if generated from a recurrence rule
}

// ─── Wall-clock → UTC conversion ────────────────────────────────────

/**
 * Convert a local date + wall-clock time in a given IANA timezone to UTC ms.
 *
 * Uses TZDate from @date-fns/tz which correctly interprets the year/month/day/
 * hour/minute values as wall-clock time in the given timezone, returning the
 * correct UTC timestamp even across month boundaries and DST transitions.
 */
function wallClockToUtcMs(
  localDateStr: string,  // "YYYY-MM-DD"
  timeStr: string,        // "HH:mm"
  tz: string,
): number {
  const [year, month, day] = localDateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  return new TZDate(year, month - 1, day, hour, minute, tz).getTime();
}

// ─── Date arithmetic helpers ─────────────────────────────────────────

// toLocalDateStr and addCalendarDays are imported from '@/lib/utils/timezone'

/** Add `n` calendar months to a "YYYY-MM-DD" string. */
function addCalendarMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  return dt.toISOString().slice(0, 10);
}

/** Day-of-week (0=Sun..6=Sat) for a "YYYY-MM-DD" string (UTC). */
function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ─── Recurrence candidate generator ─────────────────────────────────

/**
 * Generate all occurrence start dates ("YYYY-MM-DD" in wall-clock space)
 * for a recurrence rule, from `fromDateStr` up to (but not including) `toDateStr`.
 * Respects `endDate` and `count` limits.
 */
function* generateCandidateDates(
  originDateStr: string,          // the root shift's wall-clock start date
  rule: ShiftRecurrence,
  fromDateStr: string,            // window start (inclusive)
  toDateStr: string,              // window end (exclusive)
  tz: string,
): Generator<string> {
  // endDate is stored as UTC midnight of the local date string (same convention as overrideDate),
  // so extract it using 'UTC' — not the employee's timezone — to get back the original date string.
  const endDateStr = rule.endDate
    ? toLocalDateStr(
        typeof rule.endDate === 'string'
          ? new Date(rule.endDate).getTime()
          : (rule.endDate as unknown as { toMillis?: () => number; seconds?: number })
              .toMillis?.() ?? ((rule.endDate as unknown as { seconds: number }).seconds * 1000),
        'UTC',
      )
    : null;

  let emitted = 0;
  const maxCount = rule.count ?? Infinity;

  if (rule.frequency === 'daily') {
    let cursor = originDateStr;
    // Fast-forward to the window start
    while (cursor < fromDateStr) {
      cursor = addCalendarDays(cursor, rule.interval);
      emitted++;
      if (emitted >= maxCount) return;
    }
    while (cursor < toDateStr) {
      if (endDateStr && cursor > endDateStr) return;
      if (emitted >= maxCount) return;
      yield cursor;
      emitted++;
      cursor = addCalendarDays(cursor, rule.interval);
    }
  } else if (rule.frequency === 'weekly') {
    // Sort by offset from Monday (Mon=0...Sat=5, Sun=6) so iteration is chronological
    // within the week. Without this, Sunday (dow=0) sorts first numerically but maps
    // to weekMonday+6 (last day), causing premature generator termination when endDate
    // falls mid-week: Sunday's candidate exceeds endDate before Monday/Tuesday are yielded.
    const days = rule.daysOfWeek.length > 0
      ? [...rule.daysOfWeek].sort((a, b) => (a + 6) % 7 - (b + 6) % 7)
      : [dayOfWeek(originDateStr)];
    // Find the Monday of the week containing `originDateStr`
    const [oy, om, od] = originDateStr.split('-').map(Number);
    const originDow = new Date(Date.UTC(oy, om - 1, od)).getUTCDay();
    // Start from the Monday of the origin week (Sunday=0, so Monday offset = (dow+6)%7)
    let weekMonday = addCalendarDays(originDateStr, -((originDow + 6) % 7));
    let cycleCount = 0;

    while (true) {
      for (const dow of days) {
        // dow: 0=Sun..6=Sat; offset from Monday: (dow+6)%7
        const candidate = addCalendarDays(weekMonday, (dow + 6) % 7);
        if (candidate < originDateStr) continue; // before series start
        if (candidate < fromDateStr) {
          emitted++;
          if (emitted >= maxCount) return;
          continue;
        }
        if (candidate >= toDateStr) return;
        if (endDateStr && candidate > endDateStr) return;
        if (emitted >= maxCount) return;
        yield candidate;
        emitted++;
      }
      cycleCount++;
      weekMonday = addCalendarDays(weekMonday, rule.interval * 7);
      if (endDateStr && weekMonday > endDateStr) return;
      if (emitted >= maxCount) return;
    }
  } else if (rule.frequency === 'monthly') {
    let cursor = originDateStr;
    while (cursor < fromDateStr) {
      cursor = addCalendarMonths(cursor, rule.interval);
      emitted++;
      if (emitted >= maxCount) return;
    }
    while (cursor < toDateStr) {
      if (endDateStr && cursor > endDateStr) return;
      if (emitted >= maxCount) return;
      yield cursor;
      emitted++;
      cursor = addCalendarMonths(cursor, rule.interval);
    }
  }
}

// ─── Main expansion function ─────────────────────────────────────────

/**
 * Expand a list of raw API shift documents into concrete occurrences
 * that fall within [windowStartMs, windowEndMs].
 *
 * - One-time shifts (isRecurring: false, seriesId: null) that overlap the
 *   window are included as-is.
 * - Recurring root shifts (isRecurring: true, seriesId: null) are expanded
 *   into occurrences, skipping dates that have override or tombstone docs.
 * - Override docs (seriesId != null, isDeleted: false) are included as-is.
 * - Tombstone docs (isDeleted: true) are excluded.
 */
export function expandShiftsForWindow(
  shifts: RawApiShift[],
  windowStartMs: number,
  windowEndMs: number,
): ExpandedShift[] {
  const result: ExpandedShift[] = [];

  // Separate into categories
  const recurringRoots = shifts.filter(s => s.isRecurring && !s.seriesId && !s.isDeleted);
  const overrides      = shifts.filter(s => s.seriesId !== null && !s.isDeleted);
  const tombstones     = shifts.filter(s => s.isDeleted);
  const oneTime        = shifts.filter(s => !s.isRecurring && !s.seriesId && !s.isDeleted);

  // Build sets of overridden/tombstoned dates per series for fast lookup
  // Key: `${seriesId}:${localDateStr in userTimezone}`
  const suppressedDates = new Set<string>();
  for (const t of tombstones) {
    if (t.seriesId && t.overrideDate) {
      const tz = t.userTimezone || 'UTC';
      const localDate = toLocalDateStr(new Date(t.overrideDate).getTime(), tz);
      suppressedDates.add(`${t.seriesId}:${localDate}`);
    }
  }
  for (const o of overrides) {
    if (o.seriesId && o.overrideDate) {
      const tz = o.userTimezone || 'UTC';
      const localDate = toLocalDateStr(new Date(o.overrideDate).getTime(), tz);
      suppressedDates.add(`${o.seriesId}:${localDate}`);
    }
  }

  // Include one-time shifts that overlap the window
  for (const s of oneTime) {
    const startMs = new Date(s.startTime).getTime();
    const endMs   = new Date(s.endTime).getTime();
    if (endMs > windowStartMs && startMs < windowEndMs) {
      result.push({ ...s, occurrenceStart: startMs, occurrenceEnd: endMs, isOccurrence: false });
    }
  }

  // Include override docs that overlap the window
  for (const o of overrides) {
    const startMs = new Date(o.startTime).getTime();
    const endMs   = new Date(o.endTime).getTime();
    if (endMs > windowStartMs && startMs < windowEndMs) {
      result.push({ ...o, occurrenceStart: startMs, occurrenceEnd: endMs, isOccurrence: true });
    }
  }

  // Expand recurring roots
  const windowStartDateStr = toLocalDateStr(windowStartMs, 'UTC'); // window in UTC calendar days
  const windowEndDateStr   = toLocalDateStr(windowEndMs,   'UTC');

  for (const root of recurringRoots) {
    if (!root.recurrence) continue;
    const tz              = root.userTimezone || 'UTC';
    const originDateStr   = toLocalDateStr(new Date(root.startTime).getTime(), tz);
    // Window bounds in the user's local timezone
    const localWindowFrom = toLocalDateStr(windowStartMs, tz);
    // Add one day to ensure we catch shifts that start before midnight UTC but are within window
    const localWindowTo   = addCalendarDays(toLocalDateStr(windowEndMs, tz), 1);

    void windowStartDateStr; void windowEndDateStr; // suppress unused warning

    for (const candidateDate of generateCandidateDates(
      originDateStr,
      root.recurrence,
      localWindowFrom,
      localWindowTo,
      tz,
    )) {
      const suppressKey = `${root.shiftId}:${candidateDate}`;
      if (suppressedDates.has(suppressKey)) continue;

      const occurrenceStartMs = wallClockToUtcMs(candidateDate, root.wallClockStart, tz);
      const occurrenceEndMs   = wallClockToUtcMs(candidateDate, root.wallClockEnd,   tz);

      // Handle shifts that cross midnight (end < start in wall-clock)
      const adjustedEndMs = occurrenceEndMs <= occurrenceStartMs
        ? occurrenceEndMs + 24 * 3_600_000
        : occurrenceEndMs;

      // Only include if the occurrence overlaps the window.
      // We extend the upper bound by 24 h because midnight-spanning shifts for
      // employees in UTC- timezones have a UTC occurrenceStart that falls on the
      // next calendar day (e.g. Sunday 23:00 EDT = Monday 03:00 UTC), which would
      // otherwise fail the < windowEndMs check. The candidate generator already
      // constrains candidates to the local week via localWindowTo, so no
      // next-week occurrences can slip through from the candidate side.
      if (adjustedEndMs > windowStartMs && occurrenceStartMs < windowEndMs + 24 * 60 * 60 * 1000) {
        result.push({
          ...root,
          occurrenceStart: occurrenceStartMs,
          occurrenceEnd:   adjustedEndMs,
          isOccurrence:    true,
          // Override the root's start/end ISO strings with this occurrence's times
          startTime: new Date(occurrenceStartMs).toISOString(),
          endTime:   new Date(adjustedEndMs).toISOString(),
          // Override date for linking back to the series
          overrideDate: new Date(wallClockToUtcMs(candidateDate, '00:00', 'UTC')).toISOString(),
        });
      }
    }
  }

  // Sort by occurrence start
  result.sort((a, b) => a.occurrenceStart - b.occurrenceStart);

  return result;
}
