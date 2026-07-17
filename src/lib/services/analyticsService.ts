import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { toLocalDateStr } from '@/lib/utils/timezone';
import type { AnalyticsDailyDocument } from '@/types/firestore';

/**
 * Read/write surface for the `analytics_daily` rollups written nightly by the
 * `rollupDailyAnalytics` Cloud Function (functions/rollup.js).
 *
 * Rollups exist because no Firestore index supports querying `time_entries`
 * without `userId` — company-wide analytics read live would fan out across
 * every user on every dashboard load. See documentation/time-tracking.md.
 */

const DAILY = 'analytics_daily';
const DIRTY = 'analytics_dirty';

/** Firestore caps `in` queries at 30 values. */
const IN_CHUNK_SIZE = 30;

// ─── Dirty queue ─────────────────────────────────────────────────────

/**
 * Queue a user-day for recompute on the next Cloud Function run.
 *
 * The rollup's 3-day rolling window cannot catch a session whose event log
 * arrives late — a machine that crashed and was not reopened for a week
 * uploads its buffer on next launch, long after that day's rollup was written
 * with `hasIncompleteLog: true`. This queue is how that day gets corrected.
 *
 * Never throws: analytics accuracy must not be able to fail a clock-out.
 */
export async function markAnalyticsDirty(
  userId: string,
  sessionStartMs: number,
  timezone: string,
  reason: string,
): Promise<void> {
  try {
    // A session is attributed wholly to the LOCAL date of its startTime, so
    // that is the day whose rollup is now stale.
    const date = toLocalDateStr(sessionStartMs, timezone || 'UTC');
    await adminDb.collection(DIRTY).doc(`${userId}_${date}`).set({
      userId,
      date,
      markedAt: FieldValue.serverTimestamp(),
      reason,
    });
  } catch (err) {
    console.error('[analyticsService] markAnalyticsDirty failed:', err);
  }
}

// ─── Rollup reads ────────────────────────────────────────────────────

function toDoc(data: FirebaseFirestore.DocumentData): AnalyticsDailyDocument {
  return data as AnalyticsDailyDocument;
}

/** One user's rollups across an inclusive YYYY-MM-DD range. 1 query. */
export async function getRollupsForUser(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<AnalyticsDailyDocument[]> {
  const snap = await adminDb
    .collection(DAILY)
    .where('userId', '==', userId)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();
  return snap.docs.map(d => toDoc(d.data()));
}

/**
 * Rollups for a specific set of users. Chunks by 30 (Firestore `in` limit),
 * the same idiom as shiftService.getLedgerEntriesForUsers.
 */
export async function getRollupsForUsers(
  userIds: string[],
  startDate: string,
  endDate: string,
): Promise<AnalyticsDailyDocument[]> {
  if (userIds.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += IN_CHUNK_SIZE) {
    chunks.push(userIds.slice(i, i + IN_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map(chunk =>
      adminDb
        .collection(DAILY)
        .where('userId', 'in', chunk)
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get(),
    ),
  );

  return results.flatMap(snap => snap.docs.map(d => toDoc(d.data())));
}

/**
 * Every rollup in a date range, across all users.
 *
 * A single-field range on `date` — no composite index needed, and no per-user
 * fan-out. Callers must filter archived users themselves; archived users' docs
 * are retained deliberately so historical totals stay correct.
 */
export async function getRollupsByDateRange(
  startDate: string,
  endDate: string,
): Promise<AnalyticsDailyDocument[]> {
  const snap = await adminDb
    .collection(DAILY)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();
  return snap.docs.map(d => toDoc(d.data()));
}
