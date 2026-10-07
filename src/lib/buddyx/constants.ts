/**
 * BuddyX sync — the constants every scope agrees on. Plain data, safe to
 * import from client code (the UI reads the scope names and cooldown).
 */

export const BUDDYX_SCOPES = ['directory', 'sales', 'chatters', 'creators', 'fans'] as const;
export type BuddyxScope = (typeof BUDDYX_SCOPES)[number];

export function isBuddyxScope(value: unknown): value is BuddyxScope {
  return typeof value === 'string' && (BUDDYX_SCOPES as readonly string[]).includes(value);
}

/**
 * A manual refresh inside this window returns the stored data instead of
 * calling the API, so a mashed refresh button costs nothing.
 */
export const REFRESH_COOLDOWN_MS = 2 * 60_000;

/** The one-sync-at-a-time lease. Longer than `maxDuration`, so a crashed run frees it. */
export const SYNC_LEASE_MS = 6 * 60_000;

/** Stop starting new work this long into a run, leaving room to write and log. */
export const SYNC_TIME_BUDGET_MS = 240_000;

/**
 * Tip history in BuddyX begins here (verified 2026-10-06). The team-overview
 * backfill never asks for a day before it.
 */
export const BUDDYX_TEAM_STATS_START_DAY = '2026-09-27';

/**
 * The first day `creator-stats-days` takes from BuddyX. Every earlier day is
 * Infloww's (the historical *Creator Statistics* import), so the two never write
 * the same document.
 */
export const BUDDYX_CREATOR_STATS_START_DAY = '2026-10-04';

/** The earliest day the creator history reaches (the Infloww export's first day). */
export const CREATOR_HISTORY_START_DAY = '2025-10-04';

/** Subscriber events are backfilled from here on the first run. */
export const BUDDYX_SUBSCRIBERS_START_DAY = '2026-09-25';

/** The four preset periods stored whole in `buddyx-team-periods` (medians cannot be summed from days). */
export const TEAM_PERIODS = ['mtd', 'prev-month', '7d', '30d'] as const;
export type TeamPeriod = (typeof TEAM_PERIODS)[number];

/** The page each scope's manual refresh is offered from — and so the permission it requires. */
export const SCOPE_PAGE: Record<BuddyxScope, readonly string[] | null> = {
  directory: null, // admin claim
  sales: ['ca-dashboard', 'ca-admin'],
  chatters: ['ca-chatter-analytics'],
  creators: ['creators-of-analytics'],
  fans: ['ca-fan-analytics'],
};
