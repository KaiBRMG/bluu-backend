/**
 * DST-safe recurrence expansion utility.
 *
 * Shifts are stored with a wall-clock time ("09:00") and an IANA timezone
 * ("America/New_York"). When expanding recurrence, each candidate date is
 * combined with the wall-clock time and converted to UTC — so a "09:00 NY"
 * shift stays at 09:00 wall-clock time year-round even across DST transitions.
 *
 * No external library required; uses the Intl API available in all modern
 * runtimes (Node 18+, all browsers).
 */

import type { ShiftRecurrence } from '@/types/firestore';

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
 * Strategy: construct a Date from the naive local string, then measure the
 * offset that the Intl formatter applies and correct for it. This avoids
 * any dependency on external libraries while correctly handling DST.
 */
function wallClockToUtcMs(
  localDateStr: string,  // "YYYY-MM-DD"
  timeStr: string,        // "HH:mm"
  tz: string,
): number {
  const [year, month, day] = localDateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  // Build a naive Date as if it were UTC, then find the true UTC equivalent
  // by using the Intl formatter to determine what local time that UTC instant
  // represents in the target timezone. Iterate until we converge (handles DST gaps).
  let guessMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(guessMs));

    const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);
    const localYear   = get('year');
    const localMonth  = get('month');
    const localDay    = get('day');
    let   localHour   = get('hour');
    const localMinute = get('minute');

    // Intl uses 24 for midnight in some environments — normalise
    if (localHour === 24) localHour = 0;

    const diffMs =
      (year  - localYear)   * 365.25 * 24 * 3_600_000 +
      (month - localMonth)  *    30  * 24 * 3_600_000 +
      (day   - localDay)    *          24 * 3_600_000 +
      (hour  - localHour)   *               3_600_000 +
      (minute - localMinute) *                  60_000;

    if (Math.abs(diffMs) < 60_000) break;  // converged to within 1 minute
    guessMs += diffMs;
  }

  return guessMs;
}

// ─── Date arithmetic helpers ─────────────────────────────────────────

/** Returns "YYYY-MM-DD" for a UTC timestamp, optionally shifted to a timezone. */
function toLocalDateStr(utcMs: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(utcMs));
}

/**
 * Add `n` calendar days to a "YYYY-MM-DD" string, staying in wall-clock space
 * (no timezone arithmetic needed — just date arithmetic).
 */
function addCalendarDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

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
  const endDateStr = rule.endDate
    ? toLocalDateStr(
        (rule.endDate as unknown as { toMillis?: () => number; seconds?: number })
          .toMillis?.() ?? ((rule.endDate as unknown as { seconds: number }).seconds * 1000),
        tz,
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
    const days = rule.daysOfWeek.length > 0 ? [...rule.daysOfWeek].sort() : [dayOfWeek(originDateStr)];
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

      // Only include if the occurrence overlaps the window
      if (adjustedEndMs > windowStartMs && occurrenceStartMs < windowEndMs) {
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
