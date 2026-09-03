/**
 * IANA timezone helpers — the single source of truth for "is this late?".
 *
 * The overdue calculation used to be duplicated in four places (the creator
 * dashboard, the creator content-requests list, the staff content-planning
 * page, and the creator portal's own helper), and every copy hardcoded
 * `dueDate + "T23:59:59Z"` — UTC for everyone. A creator in UTC+10 saw an item
 * flip to Overdue ten hours late; one in UTC-8 saw it flip early. Due dates are
 * this product's core mechanic, so they resolve against the creator's own
 * timezone, which is detected from their device at sign-in and stored on the
 * creator record as `defaultTimezone`.
 *
 * No dependency: `Intl` gives the offset on both the server and the client, and
 * `date-fns-tz` is not installed.
 */

/** The fallback whenever a creator has no detected timezone yet. Preserves the
 *  previous behaviour rather than guessing from whoever happens to be looking. */
export const FALLBACK_TIMEZONE = 'UTC';

/**
 * The device's IANA timezone (e.g. `Europe/London`), or `null` if the runtime
 * cannot report one. Client-side only in practice — on the server this resolves
 * to the *server's* zone, which is never what we want.
 */
export function detectDeviceTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(tz) ? tz : null;
  } catch {
    return null;
  }
}

/**
 * Whether `tz` is a timezone this runtime actually understands. Used to validate
 * client input server-side — never trust a zone name off the wire, it goes
 * straight into `Intl` calls and onto a shared record.
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    // Throws RangeError for anything not in the runtime's tz database.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds to add to a UTC instant to get the wall-clock time in `tz`. */
function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const at = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');
  // `hour12: false` can render midnight as 24 in some ICU versions.
  const hour = at('hour') % 24;

  return Date.UTC(at('year'), at('month') - 1, at('day'), hour, at('minute'), at('second')) - utcMs;
}

/**
 * The UTC instant for a wall-clock time in `tz`.
 *
 * Applied twice on purpose: the first pass uses the offset at the *guessed*
 * instant, which is wrong when the guess falls on the other side of a DST
 * boundary from the real answer. The second pass re-reads the offset at the
 * corrected instant and settles it.
 */
function zonedTimeToUtcMs(
  y: number, m: number, d: number, h: number, min: number, s: number, tz: string,
): number {
  const guess = Date.UTC(y, m - 1, d, h, min, s);
  let utc = guess - offsetMs(guess, tz);
  utc = guess - offsetMs(utc, tz);
  return utc;
}

/** Resolve a timezone to something `Intl` accepts, falling back to UTC. */
export function resolveTimezone(tz: string | null | undefined): string {
  return isValidTimezone(tz) ? tz : FALLBACK_TIMEZONE;
}

/**
 * The instant a due date stops being on time, as epoch ms.
 *
 * `YYYY-MM-DD` means "any time that day in the creator's zone", so the deadline
 * is 23:59:59.999 local. `YYYY-MM-DDTHH:MM` names a specific local time and is
 * taken at face value. Returns `null` for anything unparseable, so callers fall
 * back to "not overdue" rather than inventing a deadline.
 */
export function dueDeadlineMs(
  dueDate: string | null | undefined,
  timezone?: string | null,
): number | null {
  if (!dueDate) return null;
  const [datePart, timePart] = dueDate.split('T');
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;

  const tz = resolveTimezone(timezone);

  if (timePart) {
    const [hh, mm] = timePart.split(':').map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm)) {
      return zonedTimeToUtcMs(y, m, d, hh, mm, 59, tz);
    }
  }
  return zonedTimeToUtcMs(y, m, d, 23, 59, 59, tz) + 999;
}

/**
 * Whether a due date has passed in the creator's timezone.
 *
 * Pass the creator's `defaultTimezone`. Omitting it falls back to UTC, which is
 * the old behaviour — correct only for creators who happen to live there.
 */
export function isOverdue(
  dueDate: string | null | undefined,
  timezone?: string | null,
  now: number = Date.now(),
): boolean {
  const deadline = dueDeadlineMs(dueDate, timezone);
  return deadline !== null && deadline < now;
}

/** A short label for a timezone, e.g. `Europe/London (GMT+1)`. */
export function timezoneLabel(tz: string | null | undefined): string {
  if (!isValidTimezone(tz)) return 'Not detected yet';
  try {
    const offset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value;
    const name = tz.replace(/_/g, ' ');
    return offset ? `${name} (${offset})` : name;
  } catch {
    return tz.replace(/_/g, ' ');
  }
}
