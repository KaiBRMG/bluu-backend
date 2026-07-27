/**
 * Consolidated timezone / date helpers.
 *
 * All calendar-date strings use "YYYY-MM-DD" format.
 * All IANA timezone strings are standard (e.g. "America/New_York").
 *
 * The core technique: sample the timezone offset at noon (far from midnight
 * boundaries and DST transitions) using Intl, then derive day boundaries.
 */

// ─── Timezone validation ────────────────────────────────────────────

/**
 * Coerce a possibly-unset or invalid IANA timezone to a usable one.
 *
 * `ensureUserExists` seeds `timezone: ''` and only the onboarding profile step
 * fills it in, so an empty string is a NORMAL state for anyone who has not
 * completed onboarding — not corruption. `Intl` throws a RangeError on it, and
 * `?? 'UTC'` does not catch it because `''` is not nullish. That combination is
 * how a single un-onboarded user could 500 an entire company-wide response, so
 * every helper below funnels its timezone through here instead of trusting the
 * caller to have defaulted it.
 */
const tzValidity = new Map<string, boolean>();

export function safeTimezone(timezone: string | null | undefined): string {
  if (!timezone) return 'UTC';
  let valid = tzValidity.get(timezone);
  if (valid === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      valid = true;
    } catch {
      valid = false;
    }
    tzValidity.set(timezone, valid);
  }
  return valid ? timezone : 'UTC';
}

// ─── Day bounds ─────────────────────────────────────────────────────

/**
 * Returns UTC millisecond bounds [start, end) for a calendar date (YYYY-MM-DD)
 * as observed in the given IANA timezone. Handles sub-hour offsets (India +5:30,
 * Nepal +5:45) and DST correctly.
 */
export function getDayBoundsUTC(
  dateStr: string,
  timezone: string,
): { start: number; end: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const noonUTC = Date.UTC(year, month - 1, day, 12, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(noonUTC));
  const noonH = parseInt(parts.find(p => p.type === 'hour')!.value, 10);
  const noonM = parseInt(parts.find(p => p.type === 'minute')!.value, 10);
  const offsetMs = ((noonH * 60 + noonM) - (12 * 60)) * 60 * 1000;
  const dayStartUTC = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs;
  return { start: dayStartUTC, end: dayStartUTC + 24 * 60 * 60 * 1000 - 1 };
}

/**
 * Same as getDayBoundsUTC but returns Date objects (for Firestore Timestamp
 * comparisons in backend code).
 */
export function getDayBoundsUTCDates(
  dateStr: string,
  timezone: string,
): { start: Date; end: Date } {
  const { start, end } = getDayBoundsUTC(dateStr, timezone);
  return { start: new Date(start), end: new Date(end) };
}

// ─── Date formatting ────────────────────────────────────────────────

/** Returns "YYYY-MM-DD" for a UTC timestamp in the given timezone. */
export function toLocalDateStr(utcMs: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(utcMs));
}

/** Today's date as "YYYY-MM-DD" in the given IANA timezone (defaults to UTC). */
export function todayStr(timezone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ─── Week helpers ───────────────────────────────────────────────────

/** Compute the Monday of the week that contains `dateStr` (YYYY-MM-DD). */
export function getMondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun
  const mondayOffset = (dow + 6) % 7;
  const monday = new Date(dt.getTime() - mondayOffset * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

// ─── Date arithmetic ────────────────────────────────────────────────

/**
 * Add `n` calendar days to a "YYYY-MM-DD" string, staying in wall-clock space.
 */
export function addCalendarDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
