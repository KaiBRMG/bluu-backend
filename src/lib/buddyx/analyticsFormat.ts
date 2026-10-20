/** Formatting shared by the three BuddyX analytics pages. */

/** 1h 4m · 12m 30s · 45s — durations people read, not milliseconds. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatRate(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** A 0–1 share as a percentage. */
export function formatShare(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}

/** "18 days ago" for a last purchase. */
export function daysAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return '—';
  const d = Math.floor((now - ms) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Gross or net — which half of BuddyX's `{ gross, net }` pair a figure shows. */
export type MoneyBasis = 'gross' | 'net';

/** BuddyX's split: `net = gross × 0.8` (OnlyFans keeps 20%; buddyxapi.yaml). */
export const NET_SHARE = 0.8;

/**
 * A gross figure at the chosen basis. Applied to a *summed* gross, never summed
 * from per-row nets (the API's guidance), so it can sit a few cents off
 * OnlyFans' own statement, which rounds each transaction's 80%.
 */
export function atBasis(gross: number, basis: MoneyBasis): number {
  return basis === 'net' ? gross * NET_SHARE : gross;
}
