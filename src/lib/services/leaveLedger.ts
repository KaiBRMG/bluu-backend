/**
 * The leave ledger: one entry per change a leave request makes to a balance.
 *
 * `leave-ledger/{autoId}` is the history behind Coverage → **History**. It
 * exists because the request document cannot carry that history on its own:
 * withdrawing a request **deletes** it (so the duplicate check lets the same
 * shift be asked for again), and a balance is a single number on the user document with
 * no memory of what moved it. An admin asking "why does she have two days left"
 * needs the trail, not the total.
 *
 * ## Written inside the transaction that moves the balance
 *
 * Every entry is a `tx.set` in the same `runTransaction` that updates the
 * balance, so the ledger and the balance cannot disagree — a retried
 * transaction rewrites the same entry rather than adding a second, and a
 * refused one writes nothing. That is also why an entry records `before` and
 * `after` as values read inside the transaction rather than an increment.
 *
 * ## What it does not record
 *
 * Only balance changes made **by a leave request**. The reset on finalising a month and
 * a hand edit in CA Admin → Leave move the same number without an entry; the
 * History view states that rather than implying the trail is complete.
 * Requests decided before the ledger existed have no entries either, and are
 * shown with their outcome and "not recorded" for the balance.
 *
 * Index posture (rule 9): only `at` is queried (ordered, newest first). Every
 * other field is index-exempt.
 */

import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { LeaveLedgerAction, LeaveLedgerDocument } from '@/types/firestore';
import type { LeaveType } from '@/lib/leave/leaveBalance';

export const LEAVE_LEDGER = 'leave-ledger';

/**
 * Queue a ledger entry on a transaction.
 *
 * `before`/`after` are the balance of `leaveType` either side of this change —
 * equal when the action moved nothing (an approval of a request that already
 * took its day, a denial after a reset).
 */
export function recordLeaveLedgerEntry(
  tx: Transaction,
  entry: {
    leaveId: string;
    userId: string;
    leaveType: LeaveType;
    occurrenceStart: number;
    action: LeaveLedgerAction;
    before: number;
    after: number;
    actorUid: string;
    /** For a withdrawal: what state the request was in when it was withdrawn. */
    priorStatus?: string;
  },
): void {
  const ref = adminDb.collection(LEAVE_LEDGER).doc();
  const doc: LeaveLedgerDocument = {
    entryId: ref.id,
    leaveId: entry.leaveId,
    userId: entry.userId,
    leaveType: entry.leaveType,
    occurrenceStart: entry.occurrenceStart,
    action: entry.action,
    balanceBefore: entry.before,
    balanceAfter: entry.after,
    actorUid: entry.actorUid,
    // A concrete timestamp rather than `serverTimestamp()`: the History view
    // orders by it, and a sentinel resolves to the commit time anyway.
    at: Timestamp.now(),
    ...(entry.priorStatus ? { priorStatus: entry.priorStatus } : {}),
  };
  tx.set(ref, doc);
}

/** The newest ledger entries, newest first. */
export async function getRecentLeaveLedger(limit: number): Promise<LeaveLedgerDocument[]> {
  const snap = await adminDb.collection(LEAVE_LEDGER).orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map(d => d.data() as LeaveLedgerDocument);
}
