/**
 * OnlyMonster sync — the constants every stage agrees on. Plain data, safe to
 * import from client code (DataFreshness reads the schedule).
 *
 * See documentation/onlymonster.md and onlymonster-migration.md.
 */

/**
 * The stages of a scheduled run, in order. Phase 1 ships `directory` only; each
 * later phase appends its stage here (§4.1 of the migration plan) and nothing
 * else in the orchestrator needs to change.
 */
export const ONLYMONSTER_STAGES = ['directory', 'transactions', 'subscriptions', 'massMessages', 'metrics', 'rollups', 'derive', 'reconcile', 'balances'] as const;
export type OnlyMonsterStage = (typeof ONLYMONSTER_STAGES)[number];

/** The cron schedule, as UTC hours at minute 1 (D10: the BuddyX cadence). */
export const SYNC_HOURS_UTC = [5, 13, 21] as const;
export const SYNC_MINUTE_UTC = 1;

/** One run at a time. Longer than `maxDuration` (300 s), so a crashed run frees it. */
export const SYNC_LEASE_MS = 6 * 60_000;

/** Stop starting new work this long into a run, leaving room to write and log. */
export const SYNC_TIME_BUDGET_MS = 240_000;

export const COLLECTIONS = {
  meta: 'onlymonster-meta',
  runs: 'onlymonster-sync-runs',
  accounts: 'onlymonster-accounts',
  members: 'onlymonster-members',
  txDays: 'of-transaction-days',
  chargebacks: 'of-chargebacks',
  subDays: 'of-subscription-days',
  massMessages: 'of-mass-messages',
  activityDays: 'account-activity-days',
  chatterDays: 'chatter-days',
  accountDays: 'account-days',
  reconciliation: 'account-reconciliation',
  salesShadow: 'ca-sales-shadow',
} as const;

/** D9: the account ledger is backfilled to the start of the history OnlyFans Analytics already shows. */
export const HISTORY_START_DAY = '2025-10-04';

/** OnlyMonster has member activity from this day only (probe run 2). Activity before it is BuddyX's (D24). */
export const ACTIVITY_START_DAY = '2026-11-01';

/** The run that also reconciles against `/overview-metrics` (D5, plan §4.1 stage 10). */
export const RECONCILE_HOUR_UTC = 21;

/** Mass-message stats keep moving after a send; a run re-reads this far back. */
export const MASS_MESSAGE_LOOKBACK_MS = 7 * 24 * 3600_000;

/** The next scheduled run after `now`, in ms. Used for "next 21:01" on DataFreshness. */
export function nextScheduledRun(now: number): number {
  const d = new Date(now);
  for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
    for (const h of SYNC_HOURS_UTC) {
      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOffset, h, SYNC_MINUTE_UTC);
      if (t > now) return t;
    }
  }
  return now + 8 * 3600_000;
}
