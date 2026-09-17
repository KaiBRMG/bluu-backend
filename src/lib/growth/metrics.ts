/**
 * Growth Tracking — chart math. Pure: no Firestore, no React, no dates beyond
 * the day keys the series already uses.
 *
 * ── What the modes are for, now that no shared-axis chart exists ────────────
 * The overview used to draw every account on one pair of axes and needed
 * `indexed` / `net` to stop a 684k page flattening a 13k one into the baseline.
 * That chart is gone — the roster is a grid of cards, each on its own scale — so
 * `absolute` is the only mode any surface asks for today. The other two stay
 * because they are the projection this data has always needed the moment two
 * accounts share an axis again, and they cost nothing sitting here.
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

/**
 * The selectable windows, in days of *change* — see `rangeStart`. Ordered as
 * they are rendered.
 */
export const RANGE_DAYS = { '1d': 1, '3d': 3, '7d': 7, '30d': 30, '90d': 90, all: null } as const;
export type GrowthRange = keyof typeof RANGE_DAYS;

export const RANGE_LABEL: Record<GrowthRange, string> = {
  '1d': '1 day', '3d': '3 days', '7d': '7 days', '30d': '30 days', '90d': '90 days',
  all: 'All time',
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

/**
 * The inclusive start key for a range, or `null` for "all time".
 *
 * A range is **N days of change**, not N readings: `7d` starts seven days back,
 * so the window holds the reading a week ago *and* today's, and the delta across
 * it is genuinely a week of growth.
 *
 * This is what makes `1d` a usable option at all. Under the old
 * "N days including today" reading it would have contained exactly one reading,
 * every delta on the page would have been `—` (a change needs two readings), and
 * the range would have looked broken rather than empty. The cost is that each
 * window reaches one calendar day further back than its label's narrowest
 * reading — which is the interpretation the labels were always given anyway
 * ("net growth · 7 days").
 */
export function rangeStart(range: GrowthRange, today: string = todayKey()): string | null {
  const days = RANGE_DAYS[range];
  return days === null ? null : shiftDayKey(today, -days);
}

// ─── Slicing ─────────────────────────────────────────────────────────

/** Sorted day keys of `days`, optionally clipped to `from`..∞. */
export function dayKeysIn(days: DayMap, from: string | null): string[] {
  const keys = Object.keys(days).sort();
  return from ? keys.filter((k) => k >= from) : keys;
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

/** A compact value series for an inline sparkline. */
export function sparklineFor(days: DayMap, from: string | null): SeriesPoint[] {
  return pointsFor(days, from, 'absolute');
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
/**
 * How long a manual account refresh locks itself out for.
 *
 * Here, in the pure module, rather than in the service, for the same reason
 * `MANUAL_SYNC_COOLDOWN_MS` is: the button needs it to render its own disabled
 * state and the route needs it to enforce the window, and importing the service
 * into the renderer would drag `firebase-admin` with it. The service re-exports
 * this one value.
 *
 * Deliberately the same fifteen minutes as the post-level cooldown — the two
 * buttons sit on the same panel, and a user who learned one wait should not have
 * to learn a second. They stay separate constants because they guard two
 * different bills; if one moves it should be a decision, not a side effect.
 */
export const MANUAL_REFRESH_COOLDOWN_MS = 15 * 60 * 1000;

export const STALE_AFTER_HOURS = 36;

export function isStale(lastScrapeAt: string | null, now: Date = new Date()): boolean {
  if (!lastScrapeAt) return false; // never scraped is an empty state, not a stale one
  return now.getTime() - Date.parse(lastScrapeAt) > STALE_AFTER_HOURS * 3_600_000;
}
