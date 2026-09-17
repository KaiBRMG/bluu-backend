import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { adminDb } from '@/lib/firebase-admin';
import { invalidateUserCache } from '@/lib/services/userService';
import { computeLeaveReset, leaveResetPeriods } from '@/lib/leave/leaveBalance';
import type { UserDocument } from '@/types/firestore';

/**
 * GET /api/cron/leave-reset — restore leave balances at the start of each period.
 *
 * - **Unpaid leave → 4 days on the 1st of every month.**
 * - **Paid leave → 10 days on 1 January**, for users with `hasPaidLeave`.
 *
 * Balances are assigned, not incremented: an unused month does not carry over.
 * The allotments and the decision itself live in
 * [`leaveBalance.ts`](../../../../lib/leave/leaveBalance.ts) — this route is the
 * schedule and the cohort, nothing else.
 *
 * ## It runs daily, not monthly, and that is the reliability mechanism
 *
 * A job scheduled for the 1st only works if it fires on the 1st. If the
 * deployment is mid-rollout, or Vercel drops the invocation, or the function
 * cold-starts past its timeout, that month's reset is simply lost and every
 * agent spends the month on last month's remainder — which is the failure this
 * whole change exists to prevent.
 *
 * So the schedule is daily and the decision is a **stored marker**, not a date
 * test: each user carries `unpaidLeaveResetMonth` / `paidLeaveResetYear`, and a
 * user is reset when their stamp is not the current period. That makes the job
 * idempotent (a second run the same day writes nothing) and self-healing (a run
 * missed for three days still catches up on the fourth). Nobody has to notice
 * that it failed.
 *
 * ## Why no notification
 *
 * Rule 15's catalogue covers what the system *sends*; this sends nothing. A
 * monthly "your leave reset" message is noise about a number the agent sees on
 * their dashboard the moment they need it, and the reset is not an event anyone
 * has to act on. Deliberate omission, not an oversight.
 *
 * It lives here rather than in `functions/` because it imports the leave engine
 * and the `UserDocument` type from `src/lib` (see the hub's system map).
 */

/** Firestore's hard ceiling on a single batched write. */
const BATCH_LIMIT = 450;

export async function GET() {
  const authorization = (await headers()).get('authorization');

  // Fail **closed** when CRON_SECRET is unset: this endpoint rewrites every
  // agent's leave balance, so an unauthenticated caller could hand the whole
  // company a fresh month of leave on demand.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const periods = leaveResetPeriods();

    // The cohort is everyone who can be rostered: leave is a time-tracking
    // entitlement, and `permittedPageIds` already carries that fact, so no new
    // field and no new index (rule 9). Archived users are skipped — they hold no
    // shifts, and writing to them would keep resurrecting documents the delete
    // cascade is trying to leave alone.
    const snap = await adminDb
      .collection('users')
      .where('permittedPageIds', 'array-contains', 'time-tracking')
      .get();

    const pending: Array<{ uid: string; updates: Record<string, string | number> }> = [];

    for (const doc of snap.docs) {
      const user = doc.data() as UserDocument;
      if (user.isArchived === true) continue;

      const updates = computeLeaveReset(user, periods);
      if (updates) pending.push({ uid: doc.id, updates });
    }

    // Chunked batches rather than `bulkWriter()`: this is a few dozen documents
    // once a month, and a batch keeps each chunk atomic so a mid-run failure
    // cannot leave a user with a new stamp and an old balance — the one state
    // the marker cannot recover from, because it would read as already done.
    for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
      const batch = adminDb.batch();
      for (const { uid, updates } of pending.slice(i, i + BATCH_LIMIT)) {
        batch.update(adminDb.collection('users').doc(uid), updates);
      }
      await batch.commit();
    }

    // Rule 2: every one of these is a user-document write behind a 60s cache.
    for (const { uid } of pending) invalidateUserCache(uid);

    return NextResponse.json({
      ok: true,
      period: periods,
      scanned: snap.size,
      reset: pending.length,
    });
  } catch (err) {
    console.error('[cron/leave-reset]', err);
    return NextResponse.json({ error: 'Leave reset failed' }, { status: 500 });
  }
}
