/**
 * Growth Tracking — chart math. Pure: no Firestore, no React, no dates beyond
 * the day keys the series already uses.
 *
 * The governing problem this file exists to solve: the tracked accounts differ
 * by two orders of magnitude (TwinkUniversity ~684k followers, Connor ~13k). On
 * one linear axis, eleven of twelve accounts are a flat line along the bottom
 * and the chart answers "who is biggest", which nobody needed to ask. So the
 * default view is `indexed` — every account re-based to 0% at the start of the
 * selected range — and the raw counts are one of the *other* modes.
 *
 * Gaps are normal, not exceptional. The two months of imported history were
 * typed by hand and skip most weekends, and a scrape can fail. Every function
 * here is written to tolerate a missing day rather than to interpolate one:
 * a reading that was never taken is absent, never zero. Charting a zero would
 * draw a cliff to the axis and read as "this account lost all its followers".
 */

import type { GrowthSnapshot } from '@/types/firestore';

export const GROWTH_MODES = ['indexed', 'net', 'absolute'] as const;
export type GrowthMode = (typeof GROWTH_MODES)[number];

export const MODE_LABEL: Record<GrowthMode, string> = {
  indexed: 'Growth %',
  net: 'Net change',
  absolute: 'Followers',
};

export const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, all: null } as const;
export type GrowthRange = keyof typeof RANGE_DAYS;

export const RANGE_LABEL: Record<GrowthRange, string> = {
  '7d': '7 days', '30d': '30 days', '90d': '90 days', '1y': '1 year', all: 'All time',
};

/** One account's readings, keyed by `YYYY-MM-DD`. */
export type DayMap = Record<string, GrowthSnapshot>;

export interface SeriesPoint {
  date: string;
  value: number;
}

// ─── Day keys ────────────────────────────────────────────────────────

/** `YYYY-MM-DD` for today in UTC — the series is UTC-keyed because the cron is. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The day key `days` before `from` (inclusive-start of a range). */
export function shiftDayKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two day keys. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * The inclusive start key for a range, or `null` for "all time".
 * `7d` means the last 7 days *including today*, so it shifts by 6.
 */
export function rangeStart(range: GrowthRange, today: string = todayKey()): string | null {
  const days = RANGE_DAYS[range];
  return days === null ? null : shiftDayKey(today, -(days - 1));
}

// ─── Slicing ─────────────────────────────────────────────────────────

/** Sorted day keys of `days`, optionally clipped to `from`..∞. */
export function dayKeysIn(days: DayMap, from: string | null): string[] {
  const keys = Object.keys(days).sort();
  return from ? keys.filter((k) => k >= from) : keys;
}

/**
 * The union of day keys across every account in the range, sorted. This is the
 * chart's x-axis: recharts needs one row per date with a column per account,
 * and a date no account has a reading for should simply not be a row.
 */
export function axisDays(series: Iterable<DayMap>, from: string | null): string[] {
  const all = new Set<string>();
  for (const days of series) for (const key of dayKeysIn(days, from)) all.add(key);
  return [...all].sort();
}

// ─── Deltas ──────────────────────────────────────────────────────────

export interface GrowthDelta {
  /** Followers at the first reading in range, or null if there is none. */
  first: number | null;
  /** Followers at the most recent reading in range, or null if there is none. */
  last: number | null;
  /** last − first. `null` while there are fewer than two readings. */
  change: number | null;
  /** Percentage change. `null` when undefined (no baseline, or baseline 0). */
  percent: number | null;
  /** How many readings exist in the range — drives the "not enough data" states. */
  points: number;
}

/**
 * A range delta that refuses to invent a number.
 *
 * `change` and `percent` stay `null` with fewer than two readings, which is the
 * whole reason this returns an object rather than a number: a freshly added
 * account has exactly one reading, and rendering its growth as "0" would claim
 * we measured no change when we have not yet measured anything at all.
 */
export function deltaFor(days: DayMap, from: string | null): GrowthDelta {
  const keys = dayKeysIn(days, from);
  if (keys.length === 0) return { first: null, last: null, change: null, percent: null, points: 0 };

  const first = days[keys[0]].followers;
  const last = days[keys[keys.length - 1]].followers;
  if (keys.length < 2) return { first, last, change: null, percent: null, points: 1 };

  const change = last - first;
  return {
    first,
    last,
    change,
    percent: first > 0 ? (change / first) * 100 : null,
    points: keys.length,
  };
}

// ─── Chart series ────────────────────────────────────────────────────

/**
 * Project one account's readings into the selected mode.
 *
 * `indexed` and `net` are both measured from the account's **first reading in
 * range**, not from a fixed date — an account added mid-range starts at its own
 * zero rather than being punished for not existing earlier.
 */
export function pointsFor(days: DayMap, from: string | null, mode: GrowthMode): SeriesPoint[] {
  const keys = dayKeysIn(days, from);
  if (keys.length === 0) return [];

  const base = days[keys[0]].followers;
  return keys.map((date) => {
    const followers = days[date].followers;
    if (mode === 'absolute') return { date, value: followers };
    if (mode === 'net') return { date, value: followers - base };
    // indexed — undefined against a zero baseline, so fall back to flat rather
    // than emitting Infinity and blanking the whole chart.
    return { date, value: base > 0 ? ((followers - base) / base) * 100 : 0 };
  });
}

/**
 * Recharts wants one row per x value with a key per line. Days an account has
 * no reading for are left **undefined** (not 0) so `connectNulls` bridges the
 * gap instead of drawing a spike to the axis.
 */
export function toChartRows(
  seriesByAccount: Map<string, DayMap>,
  from: string | null,
  mode: GrowthMode,
): Array<Record<string, string | number>> {
  const dates = axisDays(seriesByAccount.values(), from);
  const projected = new Map<string, Map<string, number>>();
  for (const [id, days] of seriesByAccount) {
    projected.set(id, new Map(pointsFor(days, from, mode).map((p) => [p.date, p.value])));
  }

  return dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const [id, byDate] of projected) {
      const value = byDate.get(date);
      if (value !== undefined) row[id] = value;
    }
    return row;
  });
}

/** A compact value series for an inline sparkline. */
export function sparklineFor(days: DayMap, from: string | null): SeriesPoint[] {
  return pointsFor(days, from, 'absolute');
}

// ─── Data health ─────────────────────────────────────────────────────

export interface DataHealth {
  captured: number;
  /** Days in the covered window with no reading — the hand-typed months are gappy. */
  missed: number;
  firstDay: string | null;
  lastDay: string | null;
}

/**
 * Coverage over the account's *own* window (first reading → last reading),
 * clipped to the range. Measuring against the range instead would report every
 * account as 90% missing on an "all time" view simply for being added recently.
 */
export function dataHealth(days: DayMap, from: string | null): DataHealth {
  const keys = dayKeysIn(days, from);
  if (keys.length === 0) return { captured: 0, missed: 0, firstDay: null, lastDay: null };

  const firstDay = keys[0];
  const lastDay = keys[keys.length - 1];
  const span = daysBetween(firstDay, lastDay) + 1;
  return { captured: keys.length, missed: Math.max(0, span - keys.length), firstDay, lastDay };
}

// ─── Formatting ──────────────────────────────────────────────────────

/** 683800 → "683,800" */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** 683800 → "683.8K" — for axis ticks, where the full number does not fit. */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Always carries the sign, because the sign is the information. */
export function formatDelta(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCount(Math.abs(n))}`;
}

export function formatPercent(p: number): string {
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(2)}%`;
}

/**
 * Whether the nightly job appears to have stopped. 36 hours rather than 24 so a
 * single late or slow run does not cry wolf every morning; two consecutive
 * misses do trip it.
 */
export const STALE_AFTER_HOURS = 36;

export function isStale(lastScrapeAt: string | null, now: Date = new Date()): boolean {
  if (!lastScrapeAt) return false; // never scraped is an empty state, not a stale one
  return now.getTime() - Date.parse(lastScrapeAt) > STALE_AFTER_HOURS * 3_600_000;
}
