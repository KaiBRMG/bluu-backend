/**
 * The leave ledger: one entry per change to a leave balance — a request moving
 * through its states, or an admin changing someone's allotment or adjustment.
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
 * Balances are derived (see `leaveBalance.ts`), so `before`/`after` are the
 * remaining days **in the request's period**, computed from the requests read
 * inside the transaction.
 *
 * ## What it records since 2026-10-10
 *
 * Everything that moves a balance: requests (`requested` / `approved` /
 * `denied` / `withdrawn`), one-off adjustments (`adjusted`, with the admin's
 * note) and allotment changes (`allotment`). Nothing resets on a schedule any
 * more, so the trail is complete from that date. Requests decided before the
 * ledger existed have no entries, and are shown with "not recorded".
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
 * `before`/`after` are the remaining days of `leaveType` in `period` either side
 * of this change — equal when the action moved nothing (an approval: the
 * request already held its day).
 */
export function recordLeaveLedgerEntry(
  tx: Transaction,
  entry: {
    /** The request this entry belongs to. Omitted for an admin change, which is its own row and takes its own entry id. */
    leaveId?: string;
    userId: string;
    leaveType: LeaveType;
    occurrenceStart: number;
    action: LeaveLedgerAction;
    before: number;
    after: number;
    actorUid: string;
    /** For a withdrawal: what state the request was in when it was withdrawn. */
    priorStatus?: string;
    /** The period the balance belongs to — `YYYY-MM` (unpaid) or `YYYY` (paid). */
    period: string;
    note?: string;
  },
): void {
  const ref = adminDb.collection(LEAVE_LEDGER).doc();
  const doc: LeaveLedgerDocument = {
    entryId: ref.id,
    leaveId: entry.leaveId ?? ref.id,
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
    period: entry.period,
    ...(entry.priorStatus ? { priorStatus: entry.priorStatus } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  };
  tx.set(ref, doc);
}

/** The newest ledger entries, newest first. */
export async function getRecentLeaveLedger(limit: number): Promise<LeaveLedgerDocument[]> {
  const snap = await adminDb.collection(LEAVE_LEDGER).orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map(d => d.data() as LeaveLedgerDocument);
}

