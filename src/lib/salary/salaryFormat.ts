/**
 * Presentation helpers for salary figures.
 *
 * Every surface that shows money goes through here, so a dollar sign, a minus
 * sign and a rounding decision look the same on the agent's dashboard and in the
 * payroll grid. All of it is client-safe — no Firestore, no Node built-ins.
 */

import { safeTimezone } from '../utils/timezone';

/** `$1,234.56`. Negative amounts read `−$5.00` with a real minus, not a hyphen. */
export function formatUsd(amount: number, options: { cents?: boolean } = {}): string {
  const cents = options.cents ?? true;
  const abs = Math.abs(amount);
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return `${amount < 0 ? '−' : ''}$${body}`;
}

/**
 * A compact figure for a tile: `$12.6k` past a thousand, exact below it.
 *
 * Only for headline metrics where the magnitude is the message. Never for a
 * figure someone has to reconcile — a rounded payout is a support ticket.
 */
export function formatUsdCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs < 1000) return formatUsd(amount, { cents: abs % 1 !== 0 });
  const sign = amount < 0 ? '−' : '';
  if (abs < 1_000_000) return `${sign}$${(abs / 1000).toFixed(abs < 10_000 ? 1 : 0)}k`;
  return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
}

/**
 * `7.75` → `7h 45m`.
 *
 * Decimal hours are what the engine computes and what an admin types, but they
 * are not how anyone thinks about a shift. `0` renders as `—`: a day not worked
 * and a day worked for zero minutes are the same fact, and `0h 0m` is noise in a
 * column of thirty rows.
 */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '—';
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  if (minutes === 60) return `${whole + 1}h`;
  if (whole === 0) return `${minutes}m`;
  if (minutes === 0) return `${whole}h`;
  return `${whole}h ${minutes}m`;
}

/** `2.5` → `2.5%`, `3` → `3%`. Trailing `.0` is noise in a dense column. */
export function formatPercent(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}

/** A count with its noun, pluralised. `1 account` / `3 accounts`. */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Render a timestamp in the reader's own timezone.
 *
 * Salary *days* are bucketed in the company timezone (see `salaryDate.ts`), but
 * an individual sale's clock time is only meaningful to the agent in their own —
 * "I remember that tip" needs their evening, not Harare's.
 *
 * Funnelled through `safeTimezone` because an unset timezone is stored as `''`,
 * which `Intl` rejects with a RangeError rather than ignoring. These helpers are
 * called from several surfaces, so they defend themselves rather than trusting
 * every caller to have resolved it.
 */
/**
 * Formatters are cached per timezone, because *constructing* an
 * `Intl.DateTimeFormat` is the expensive part (~50-100us) and `.format()` is
 * nearly free. `formatSaleDateTime` is called once per row of the sales report,
 * which re-renders on every keystroke in its search box — so a month with a few
 * hundred sales was building a few hundred formatters per character typed.
 *
 * The key includes the shape as well as the zone: the two functions below want
 * different options and must not share an entry.
 */
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(shape: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const zone = safeTimezone(timeZone);
  const key = `${shape}:${zone}`;
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone });
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatSaleTime(iso: string, timeZone: string): string {
  return dateTimeFormatter('time', timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export function formatSaleDateTime(iso: string, timeZone: string): string {
  return dateTimeFormatter('datetime', timeZone, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/** A relative stamp for an audit line — "3 days ago". Falls back to a date past a month. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86400)}d ago`;

  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(then));
}

/**
 * The class triad for a signed money figure.
 *
 * Green for a gain is *not* used: every ordinary day is a gain, so colouring
 * them all green spends the palette on the default case and leaves nothing for a
 * reversal to mean (DESIGN.md §2 — colour is rationed as signal). Only negative
 * figures take a hue.
 */
export function signedMoneyClass(amount: number): string {
  return amount < 0 ? 'text-red-400' : 'text-foreground';
}
