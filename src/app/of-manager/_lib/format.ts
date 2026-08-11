/**
 * Time + money formatting for the OF Manager window.
 *
 * All timestamps come off the provider as ISO-8601 UTC and are rendered in the
 * operator's own timezone (from their user doc, falling back to the machine's) —
 * they are reading a live conversation, not an audit record.
 */

function formatter(timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-GB', { ...options, ...(timeZone ? { timeZone } : {}) });
}

/** `3:52 pm` — the timestamp under a bubble and beside a list row. */
export function formatClock(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatter(timeZone, { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(date)
    .toLowerCase();
}

/** List rows: clock time today, weekday this week, date beyond that. */
export function formatListTime(iso: string | null, timeZone?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const ageMs = Date.now() - date.getTime();
  if (ageMs < 24 * 60 * 60 * 1000 && isSameDay(date, new Date(), timeZone)) {
    return formatClock(iso, timeZone);
  }
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return formatter(timeZone, { weekday: 'short' }).format(date);
  return formatter(timeZone, { day: 'numeric', month: 'short' }).format(date);
}

/** Thread separators: `Today` / `Yesterday` / `2 Aug 2026`. */
export function formatDayLabel(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (isSameDay(date, now, timeZone)) return 'Today';
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (isSameDay(date, yesterday, timeZone)) return 'Yesterday';
  return formatter(timeZone, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** Stable per-day key used to group messages into separators. */
export function dayKey(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatter(timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function isSameDay(a: Date, b: Date, timeZone?: string): boolean {
  const fmt = formatter(timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(a) === fmt.format(b);
}

/** `$817` — whole dollars, tabular by the class that renders it. */
export function formatMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}
