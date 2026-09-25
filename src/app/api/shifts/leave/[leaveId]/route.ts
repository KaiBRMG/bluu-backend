import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { notifications } from '@/lib/notificationContent';
import { CA_LEAVE_ALERT_RECIPIENT_UID, formatNameList, notifyUsers } from '@/lib/services/caNotifications';
import { queueCoverageNotice, recordLeaveWithdrawal } from '@/lib/services/coverageNotices';
import { revertOccurrenceCoverage } from '@/lib/services/leaveCoverage';
import { leaveRefund, remainingOf } from '@/lib/leave/leaveBalance';
import { recordLeaveLedgerEntry } from '@/lib/services/leaveLedger';
import { formatDayLabelWithWeekday, toDayKey } from '@/lib/salary/salaryDate';
import { pluralise } from '@/lib/salary/salaryFormat';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LeaveRequestDocument, UserDocument } from '@/types/firestore';

// ─── DELETE /api/shifts/leave/[leaveId] ────────────────────────────────────
//
// Withdrawing a leave request. Two very different operations behind one verb:
//
// - A **pending or denied** request is a row going away. Nobody has acted on it,
//   so nobody is told — the only other effect is a pending request's day going
//   back on the balance (a denied one was refunded at denial).
// - An **approved** one has already moved the world: the shift occurrence was
//   tombstoned and every creator the agent was covering was posted to the
//   overtime board, where somebody may now be assigned and being paid to cover
//   it. Withdrawing has to unwind all of that — see `revertOccurrenceCoverage`
//   — and then tell the three parties who acted on the old state: whoever was
//   assigned cover, and the person who approved the leave.
//
// The unwind runs **after** the withdrawal is committed and is deliberately
// non-fatal, the same shape as the release on approval: the agent asked to
// cancel, the cancellation succeeded, and a board that could not be tidied must
// not surface as "could not cancel your leave".

export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ leaveId: string }>,
) => {
  try {
    const { leaveId } = await params;

    const leaveRef = adminDb.collection('leave_requests').doc(leaveId);
    const leaveDoc = await leaveRef.get();

    if (!leaveDoc.exists) {
      return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
    }

    const leave = leaveDoc.data() as LeaveRequestDocument;

    // Only the owner can cancel their own leave request
    if (leave.userId !== token.uid) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const wasApproved = leave.status === 'approved';

    // ── The refund, and only where one is owed ──
    //
    // Requesting takes a day, so withdrawing a **pending or approved** request
    // gives it back. A denied one was refunded at denial and gives back nothing
    // — refunding it again is how an agent would gain a day. `leaveRefund` reads
    // the marker the request carries rather than its status, and declines when a
    // reset has happened since the day was taken (the reset already restored
    // the allotment).
    //
    // Transactional, reading the leave and the user inside it: the refund is
    // computed from values read in the same operation, so a withdrawal racing a
    // denial or a month's finalisation cannot refund twice or write back a pre-reset
    // number.
    await adminDb.runTransaction(async tx => {
      const userRef = adminDb.collection('users').doc(leave.userId);
      const [freshLeaveSnap, userSnap] = await Promise.all([tx.get(leaveRef), tx.get(userRef)]);
      const freshLeave = freshLeaveSnap.data() as LeaveRequestDocument | undefined;
      if (!freshLeave) return;

      const freshUser = userSnap.data() as UserDocument | undefined;
      const before = remainingOf(freshUser, freshLeave.leaveType);
      const refund = leaveRefund(freshUser, freshLeave);
      if (refund) tx.update(userRef, refund);

      tx.delete(leaveRef);
      // The request document is gone after this; the ledger entry is what
      // keeps the withdrawal visible in Coverage → History.
      recordLeaveLedgerEntry(tx, {
        leaveId: freshLeave.leaveId,
        userId: freshLeave.userId,
        leaveType: freshLeave.leaveType,
        occurrenceStart: freshLeave.occurrenceStart,
        action: 'withdrawn',
        before,
        after: refund ? before + 1 : before,
        actorUid: token.uid,
        priorStatus: freshLeave.status,
      });
    });

    invalidateUserCache(leave.userId);

    if (!wasApproved) {
      return NextResponse.json({ success: true, reverted: null });
    }

    let reverted: Awaited<ReturnType<typeof revertOccurrenceCoverage>> | null = null;
    try {
      reverted = await revertOccurrenceCoverage({
        shiftId: leave.shiftId,
        occurrenceStart: leave.occurrenceStart,
        leaveId: leave.leaveId,
        // What the approval actually released — see `revertOccurrenceCoverage`.
        releasedShiftId: leave.releasedShiftId ?? null,
        releasedOccurrenceStart: leave.releasedOccurrenceStart ?? null,
      });
    } catch (revertErr) {
      console.error('[shifts/leave DELETE] coverage revert failed', revertErr);
    }

    if (reverted) {
      const day = toDayKey(leave.occurrenceStart);
      const dateStr = formatDayLabelWithWeekday(day);
      const requester = await getUserById(leave.userId);
      const requesterName = requester?.displayName ?? leave.userId;

      // ── The agents who lose their overtime ──
      // Queued, not sent: one absence can hand four accounts to the same person,
      // and cancelling them individually would message that person four times in
      // the same second. The queue collapses them into one notification naming
      // every creator — see `coverageNotices.ts`.
      for (const entry of reverted.reverted) {
        await queueCoverageNotice({
          kind: 'cancelled',
          userId: entry.userId,
          day,
          creatorNames: entry.creatorNames,
        });
      }

      // ── The approver ──
      const revertedLabel =
        reverted.reverted.length > 0
          ? `overtime assigned to ${formatNameList(
              await resolveDisplayNames(reverted.reverted.map(r => r.userId)),
            )} has been cancelled.`
          : reverted.offersRemoved > 0
            ? `${pluralise(reverted.offersRemoved, 'account')} taken off the overtime board.`
            : 'nothing was on the overtime board for it.';

      await notifyUsers(
        [CA_LEAVE_ALERT_RECIPIENT_UID],
        notifications.leaveWithdrawn(requesterName, leave.leaveType, dateStr, revertedLabel),
        { label: 'leaveWithdrawn' },
      );

      // ── The record the Coverage tab reads ──
      // Offers are deleted by the revert, which is correct but leaves an admin
      // who saw four accounts on the board yesterday with no explanation. This
      // is that explanation.
      await recordLeaveWithdrawal({
        leaveId: leave.leaveId,
        userId: leave.userId,
        displayName: requesterName,
        day,
        leaveType: leave.leaveType,
        creatorNames: reverted.creatorNames,
        reverted: await Promise.all(
          reverted.reverted.map(async entry => ({
            userId: entry.userId,
            displayName: (await getUserById(entry.userId))?.displayName ?? entry.userId,
            creatorNames: entry.creatorNames,
          })),
        ),
        shiftRestored: reverted.shiftRestored,
      });
    }

    return NextResponse.json({ success: true, reverted });
  } catch (err) {
    console.error('[shifts/leave DELETE]', err);
    return NextResponse.json({ error: 'Failed to cancel leave request' }, { status: 500 });
  }
});

/** Display names for a handful of uids, through the 60s user cache (rule 9). */
async function resolveDisplayNames(uids: string[]): Promise<string[]> {
  const names = await Promise.all(uids.map(async uid => (await getUserById(uid))?.displayName ?? uid));
  return names;
}
