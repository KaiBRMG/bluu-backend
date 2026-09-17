/**
 * Growth Tracking — post engagement math. Pure: no Firestore, no React, no
 * network. Shared by the service, the cron and the UI so the refresh ladder the
 * server enforces is the same one the page describes to the user.
 *
 * Two ideas govern this file, and both are inherited from `metrics.ts`:
 *
 *  1. **A reading that was never taken is absent, never zero.** Engagement can
 *     only ever be read as *today's* value — there is no backfill — so a post
 *     tracked from day 10 has nothing for days 0–9, and a refresh that failed
 *     leaves a gap. Every function here tolerates a missing point rather than
 *     interpolating one.
 *  2. **Nothing is extrapolated.** Velocity is measured *between two readings
 *     that happened*; it is never projected forward to make a counter tick. The
 *     page states how fresh a number is instead of pretending it is live.
 */

import type { GrowthPostSnapshot } from '@/types/firestore';

// ─── Metrics ─────────────────────────────────────────────────────────

/**
 * The engagement metrics, in the order they are shown. Every one of these
 * arrives inside the same billed result as the post itself, so tracking all of
 * them costs exactly what tracking one would.
 */
export const POST_METRICS = ['likes', 'reposts', 'replies', 'quotes', 'views', 'bookmarks'] as const;
export type PostMetric = (typeof POST_METRICS)[number];

export const METRIC_LABEL: Record<PostMetric, string> = {
  likes: 'Likes',
  reposts: 'Reposts',
  replies: 'Replies',
  quotes: 'Quotes',
  views: 'Views',
  bookmarks: 'Bookmarks',
};

/**
 * The four metrics that sum to "engagement". Views are excluded deliberately —
 * they are an impression count one to three orders of magnitude larger than the
 * rest, so including them would make the total a proxy for views and nothing
 * else. Bookmarks are excluded because X reports them inconsistently.
 */
export const ENGAGEMENT_METRICS: readonly PostMetric[] = ['likes', 'reposts', 'replies', 'quotes'];

/** Total engagement for a reading, skipping metrics the scraper omitted. */
export function totalEngagement(snapshot: GrowthPostSnapshot): number {
  let total = 0;
  for (const metric of ENGAGEMENT_METRICS) {
    const value = snapshot[metric];
    if (typeof value === 'number') total += value;
  }
  return total;
}

/** One metric out of a reading, or `null` when it was not reported. */
export function metricValue(snapshot: GrowthPostSnapshot, metric: PostMetric | 'engagement'): number | null {
  if (metric === 'engagement') return totalEngagement(snapshot);
  const value = snapshot[metric];
  return typeof value === 'number' ? value : null;
}

// ─── Snapshot keys ───────────────────────────────────────────────────

/**
 * A reading's key: UTC to the minute, `YYYY-MM-DDTHH:mm`.
 *
 * Minute precision rather than the day key the follower series uses, because a
 * post is read several times on the day it is published and a day key would
 * collapse those into one. It sorts lexically, which is the only property
 * anything here depends on.
 */
export function snapshotKey(at: Date): string {
  return at.toISOString().slice(0, 16);
}

/** A snapshot key back to a Date. */
export function snapshotDate(key: string): Date {
  return new Date(`${key}:00Z`);
}

/** Sorted keys of a history map, optionally clipped to `from` (inclusive). */
export function historyKeys(history: PostHistory, from?: string | null): string[] {
  const keys = Object.keys(history).sort();
  return from ? keys.filter((k) => k >= from) : keys;
}

/** Reading key (`YYYY-MM-DDTHH:mm`) → the metrics read at that moment. */
export type PostHistory = Record<string, GrowthPostSnapshot>;

// ─── The refresh ladder ──────────────────────────────────────────────

/**
 * ═══ THIS LADDER IS THE BILL ═══
 *
 * Every rung is a multiplier on what post tracking costs, and the cost is
 * per *reading*, not per call — so halving an interval doubles the spend for
 * that band. A post's engagement is functionally settled inside a week; past
 * thirty days it is a historical record, not a live measurement.
 *
 * Total over a post's tracked life: ~4 readings on day one, ~4 across days 1–3,
 * ~4 across days 3–7, ~3 across days 7–30 — about **15 readings, ≈$0.004 per
 * post, ever**. Tightening the first rung to hourly would take that to ~$0.02
 * and buy a curve nobody reads differently.
 */
export const REFRESH_TIERS = [
  { maxAgeHours: 24, intervalHours: 6, state: 'live' },
  { maxAgeHours: 72, intervalHours: 12, state: 'hourly' },
  { maxAgeHours: 24 * 7, intervalHours: 24, state: 'daily' },
  { maxAgeHours: 24 * 30, intervalHours: 24 * 7, state: 'weekly' },
] as const;

export type RefreshState = 'live' | 'hourly' | 'daily' | 'weekly' | 'frozen';

/** How often a post of this age is re-read, or `null` once it is frozen. */
export function refreshIntervalHours(ageHours: number): number | null {
  for (const tier of REFRESH_TIERS) {
    if (ageHours < tier.maxAgeHours) return tier.intervalHours;
  }
  return null;
}

export function refreshStateFor(ageHours: number): RefreshState {
  for (const tier of REFRESH_TIERS) {
    if (ageHours < tier.maxAgeHours) return tier.state;
  }
  return 'frozen';
}

/**
 * How the page explains a post's cadence. Honest about the ceiling: "about every
 * 6 hours" rather than a countdown, because the cron fires on its own schedule
 * and a post is read on the first run after it comes due, not on the minute.
 */
export const REFRESH_STATE_LABEL: Record<RefreshState, string> = {
  live: 'Refreshes about every 6 hours',
  hourly: 'Refreshes about every 12 hours',
  daily: 'Refreshes daily',
  weekly: 'Refreshes weekly',
  frozen: 'Frozen — over 30 days old',
};

/** Post age in hours at `now`. Negative ages (clock skew) clamp to zero. */
export function ageHoursOf(postedAt: string | null, now: Date = new Date()): number {
  if (!postedAt) return 0;
  const ms = now.getTime() - Date.parse(postedAt);
  return Number.isFinite(ms) ? Math.max(0, ms / 3_600_000) : 0;
}

/**
 * How long before the same post may be read by hand again.
 *
 * Lives here, in the pure module, because both sides need it and they must not
 * disagree: the server ENFORCES it (`/posts/[tweetId]/sync` 429s inside the
 * window — a client-side timer is not a cooldown, cross-cutting rule 10) and the
 * client uses it only to disable the button and say how long is left. If these
 * were two constants they would drift, and the UI would offer an action the
 * server refuses.
 */
export const MANUAL_SYNC_COOLDOWN_MS = 15 * 60 * 1000;

// ─── Velocity ────────────────────────────────────────────────────────

export interface PostVelocity {
  /** Change in the metric between the two most recent readings. */
  change: number;
  /** Hours between those readings — the window the change was measured over. */
  hours: number;
  /** Change per 24h, the rate the UI shows. */
  perDay: number;
}

/**
 * Rate of change across the last two readings, or `null` when there are fewer
 * than two.
 *
 * This is a *measurement*, not a projection. Nothing multiplies it by elapsed
 * time to animate a counter — engagement velocity decays sharply, so a linear
 * projection overshoots and then visibly snaps back, which reads as data loss on
 * a page whose whole contract is that its numbers were observed.
 */
export function velocityFor(
  history: PostHistory,
  metric: PostMetric | 'engagement',
): PostVelocity | null {
  const keys = historyKeys(history);
  if (keys.length < 2) return null;

  const last = metricValue(history[keys[keys.length - 1]], metric);
  const prev = metricValue(history[keys[keys.length - 2]], metric);
  if (last === null || prev === null) return null;

  const hours = (snapshotDate(keys[keys.length - 1]).getTime()
    - snapshotDate(keys[keys.length - 2]).getTime()) / 3_600_000;
  if (!(hours > 0)) return null;

  const change = last - prev;
  return { change, hours, perDay: (change / hours) * 24 };
}

// ─── Chart projection ────────────────────────────────────────────────

export interface PostPoint {
  /** Snapshot key — `YYYY-MM-DDTHH:mm`, UTC. */
  t: string;
  /** Milliseconds since epoch, for a time-scaled axis. */
  ms: number;
  value: number;
}

/**
 * One metric's readings as chart points. Readings where the scraper omitted the
 * metric are dropped rather than zeroed, so `connectNulls` bridges them the same
 * way the follower chart bridges a missed night.
 */
export function pointsForMetric(
  history: PostHistory,
  metric: PostMetric | 'engagement',
  from?: string | null,
): PostPoint[] {
  const points: PostPoint[] = [];
  for (const key of historyKeys(history, from)) {
    const value = metricValue(history[key], metric);
    if (value === null) continue;
    points.push({ t: key, ms: snapshotDate(key).getTime(), value });
  }
  return points;
}

/**
 * The *rate* between each consecutive pair of readings, in units per day.
 *
 * ── Why a card's sparkline draws this and not the running total ─────────────
 * Engagement is cumulative and essentially never falls, so a trace of the total
 * is the same shape on every post that ever worked: a rise that flattens. Worse,
 * `Sparkline` scales to its own min/max, so a post that gained 3 and a post that
 * gained 1,600 draw an identical full-height climb. A mark whose shape never
 * varies encodes nothing — the same test that took colour off the post card,
 * applied to the other half of its vocabulary.
 *
 * The rate does vary, and it varies in the direction that matters: it rises
 * while a post is spreading and decays toward zero as it settles, which is the
 * one question a refresh can still change the answer to. Drawn zero-based (see
 * `Sparkline`'s `zeroBased`), "has this finished?" becomes readable at 36px.
 *
 * It is a rate rather than a raw increment because the ladder's intervals are
 * not equal — 6h early, then 12h, then daily, then weekly. Plotting raw
 * increments side by side would draw the weekly reading as a spike when all it
 * did was accumulate over seven times as long.
 *
 * `from` clips the output, not the input: the first pair inside the window still
 * uses the last reading *before* it as its base, so the window's opening rate is
 * a measurement rather than a gap.
 */
export function ratePointsFor(
  history: PostHistory,
  metric: PostMetric | 'engagement',
  from?: string | null,
): PostPoint[] {
  const all = pointsForMetric(history, metric);
  const rates: PostPoint[] = [];

  for (let i = 1; i < all.length; i += 1) {
    const prev = all[i - 1];
    const curr = all[i];
    if (from && curr.t < from) continue;
    const hours = (curr.ms - prev.ms) / 3_600_000;
    if (!(hours > 0)) continue;
    rates.push({ t: curr.t, ms: curr.ms, value: ((curr.value - prev.value) / hours) * 24 });
  }

  return rates;
}

/**
 * Rows for a multi-line chart: one row per reading, one column per metric.
 * Metrics a reading is missing are simply absent from the row.
 */
export function toPostChartRows(
  history: PostHistory,
  metrics: readonly (PostMetric | 'engagement')[],
  from?: string | null,
): Array<Record<string, string | number>> {
  return historyKeys(history, from).map((key) => {
    const row: Record<string, string | number> = { t: key, ms: snapshotDate(key).getTime() };
    for (const metric of metrics) {
      const value = metricValue(history[key], metric);
      if (value !== null) row[metric] = value;
    }
    return row;
  });
}

// ─── Deltas ──────────────────────────────────────────────────────────

export interface PostDelta {
  first: number | null;
  last: number | null;
  /** `null` until there are two readings — one reading is not a change of zero. */
  change: number | null;
  percent: number | null;
  points: number;
}

/** A range delta over a post's history that refuses to invent a number. */
export function postDeltaFor(
  history: PostHistory,
  metric: PostMetric | 'engagement',
  from?: string | null,
): PostDelta {
  const points = pointsForMetric(history, metric, from);
  if (points.length === 0) return { first: null, last: null, change: null, percent: null, points: 0 };

  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (points.length < 2) return { first, last, change: null, percent: null, points: 1 };

  const change = last - first;
  return { first, last, change, percent: first > 0 ? (change / first) * 100 : null, points: points.length };
}

// ─── Freshness ───────────────────────────────────────────────────────

/**
 * How a reading's age is described. The page never claims to be live, so this
 * is the whole of its real-time story: an honest, precise statement of when the
 * number was taken.
 */
export function formatAge(isoTime: string | null, now: Date = new Date()): string {
  if (!isoTime) return 'never refreshed';
  const ms = now.getTime() - Date.parse(isoTime);
  if (!Number.isFinite(ms)) return 'never refreshed';
  if (ms < 60_000) return 'just now';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Whether a post's last reading is older than its own cadence allows — the
 * per-post equivalent of `isStale`. Scaled by 2 so one missed cycle is tolerated
 * and two are not, matching `STALE_AFTER_HOURS`' reasoning for the roster.
 */
export function isPostStale(
  lastReadAt: string | null,
  ageHours: number,
  now: Date = new Date(),
): boolean {
  if (!lastReadAt) return false; // never read is an empty state, not a stale one
  const interval = refreshIntervalHours(ageHours);
  if (interval === null) return false; // frozen posts are not stale, they are done
  return now.getTime() - Date.parse(lastReadAt) > interval * 2 * 3_600_000;
}

// ─── The next reading ────────────────────────────────────────────────

/**
 * A frozen post's `nextRefreshAt` is a year-9999 sentinel rather than `null`,
 * because a null sorts before every timestamp in Firestore and would make frozen
 * posts the first thing the "what is due?" query returned. Anything this far out
 * is that sentinel, not a schedule.
 */
export function isFrozenRefreshAt(iso: string | null): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).getUTCFullYear() >= 9000;
}

/**
 * A countdown to the next reading.
 *
 * ═══ THIS IS THE ONLY THING ON THE PAGE THAT MAY TICK ═══
 *
 * `nextRefreshAt` is a real future timestamp the server has already committed
 * to, so counting down to it is a statement of fact and stays true with no
 * further information. That is exactly what the engagement counts are not: they
 * are known only at the instants they were read, and animating them between
 * readings would be fabrication (see the file header).
 *
 * Seconds appear only under ten minutes. A seconds field on a four-hour wait is
 * motion for its own sake; on a four-minute one it is the page telling you to
 * wait rather than reload.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'due now';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 10) return `${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * The soonest next reading across a set of posts — the roster-level pulse.
 * Frozen posts are skipped: they have no next reading, and letting a year-9999
 * sentinel win would render a countdown of several thousand years.
 */
export function soonestRefresh(
  posts: Array<{ nextRefreshAt: string | null; isActive: boolean }>,
): number | null {
  let soonest: number | null = null;
  for (const post of posts) {
    if (!post.isActive || !post.nextRefreshAt || isFrozenRefreshAt(post.nextRefreshAt)) continue;
    const time = Date.parse(post.nextRefreshAt);
    if (!Number.isFinite(time)) continue;
    if (soonest === null || time < soonest) soonest = time;
  }
  return soonest;
}

/** `+240 likes/day` — a measured rate, stated with the sign doing the work. */
export function formatVelocity(perDay: number): string {
  const rounded = Math.round(perDay);
  if (rounded === 0) return 'no change';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-US')}/day`;
}
