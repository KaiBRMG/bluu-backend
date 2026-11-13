import { ONLYMONSTER_CUTOVER_AT } from '../salary/salaryConstants';
import { addDays, toDayKey } from '../salary/salaryDate';

/**
 * Where the analytics history reaches, and how archived rows are keyed.
 *
 * BuddyX is retired (onlymonster-migration.md, Phase 6), but the history it
 * wrote is kept in place and read as archive: Chatter Analytics' activity
 * before OnlyMonster's (carried into `chatter-days`), OnlyFans Analytics'
 * `creator-stats-days`, and the tracking-link table. These constants describe
 * that archive; nothing here talks to BuddyX.
 */

/** The earliest day the creator history reaches (the Infloww export's first day). */
export const CREATOR_HISTORY_START_DAY = '2025-10-04';

/**
 * Chatter activity (messages, fans chatted, PPVs sent) exists from here: BuddyX's
 * team reports until 31 Oct 2026, carried into `chatter-days`, then OnlyMonster's.
 * Before it, activity is `null` (rendered "—", never 0).
 */
export const ACTIVITY_HISTORY_START_DAY = '2026-09-27';

/**
 * Archived `creator-stats-days` rows for a BuddyX model that was never mapped to
 * a Bluu creator are keyed `buddyx:{modelId}`, so the money still shows on
 * OnlyFans Analytics, flagged as unmapped. Rows of a model mapped later are
 * folded into its creator on read.
 */
const UNMAPPED_MODEL_PREFIX = 'buddyx:';

export function unmappedModelKey(modelId: string): string {
  return `${UNMAPPED_MODEL_PREFIX}${modelId}`;
}

/** The model id behind an unmapped key, or null for a real creator id. */
export function modelIdOfUnmappedKey(key: string): string | null {
  return key.startsWith(UNMAPPED_MODEL_PREFIX) ? key.slice(UNMAPPED_MODEL_PREFIX.length) : null;
}

/**
 * The last salary day BuddyX's archive means anything: the day before the
 * OnlyMonster cutover. Its sync kept running after the team left BuddyX and
 * wrote **zeros** from the cutover on (`creator-stats-days`, `buddyx-team-hours`
 * — 0 online, 0 messages), so no reader may take a BuddyX row after this day:
 * it would show OnlyMonster-era shifts as "never online" and creators as $0.
 */
export const BUDDYX_LAST_DAY = addDays(toDayKey(ONLYMONSTER_CUTOVER_AT), -1);
