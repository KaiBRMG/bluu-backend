/**
 * Time + money formatting for the OF Manager window.
 *
 * All timestamps come off the provider as ISO-8601 UTC and are rendered in the
 * operator's own timezone (from their user doc, falling back to the machine's) —
 * they are reading a live conversation, not an audit record.
 *
 * Calendar comparisons go through `calendarDay` (a zone-resolved `YYYY-MM-DD`),
 * never arithmetic on epoch milliseconds: a DST day is 23 or 25 hours long, so
 * `now - 24h` lands on the wrong date twice a year.
 */

function formatter(timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-GB', { ...options, ...(timeZone ? { timeZone } : {}) });
}

/** `2026-08-11` — the calendar date in the operator's zone. */
function calendarDay(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/** The calendar day before `ymd`, done on the date itself so DST can't shift it. */
function previousCalendarDay(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day) - 24 * 60 * 60 * 1000);
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(
    previous.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** `3:52 pm` — the timestamp under a bubble and beside a list row. */
export function formatClock(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatter(timeZone, { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(date)
    .toLowerCase();
}

/**
 * List rows: clock time today, weekday within the last six days, date beyond
 * that. Six, not seven — at seven the weekday name repeats and "Mon" stops
 * telling the operator which Monday.
 */
export function formatListTime(iso: string | null, timeZone?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (calendarDay(date, timeZone) === calendarDay(now, timeZone)) {
    return formatClock(iso, timeZone);
  }
  if (now.getTime() - date.getTime() < 6 * 24 * 60 * 60 * 1000) {
    return formatter(timeZone, { weekday: 'short' }).format(date);
  }
  return formatter(timeZone, { day: 'numeric', month: 'short' }).format(date);
}

/** Thread separators: `Today` / `Yesterday` / `2 Aug 2026`. */
export function formatDayLabel(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = calendarDay(date, timeZone);
  const today = calendarDay(new Date(), timeZone);
  if (day === today) return 'Today';
  if (day === previousCalendarDay(today)) return 'Yesterday';
  return formatter(timeZone, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** Stable per-day key used to group messages into separators. */
export function dayKey(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return calendarDay(date, timeZone);
}

/**
 * `$817`, or `$0.40` under a dollar — rounding sub-dollar spend to `$0` renders
 * a chip that says a paying fan paid nothing.
 */
export function formatMoney(amount: number): string {
  if (amount > 0 && amount < 1) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/**
 * The same amount, split so the currency mark can be set apart from the digits.
 *
 * Only worth it where an amount is displayed large enough for the `$` to shout
 * at the same size as the number — a full-size symbol next to 32px digits reads
 * as a typo. Typeset small and dimmed beside them, the digits carry the line.
 */
export function splitMoney(amount: number): { symbol: string; digits: string } {
  const formatted = formatMoney(amount);
  return { symbol: formatted.slice(0, 1), digits: formatted.slice(1) };
}
