import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { notifications } from '@/lib/notificationContent';
import { CA_LEAVE_ALERT_RECIPIENT_UID, formatNameList, notifyUsers } from '@/lib/services/caNotifications';
import { queueCoverageNotice, recordLeaveWithdrawal } from '@/lib/services/coverageNotices';
import { revertOccurrenceCoverage } from '@/lib/services/leaveCoverage';
import { formatDayLabelWithWeekday, toDayKey } from '@/lib/salary/salaryDate';
import { pluralise } from '@/lib/salary/salaryFormat';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LeaveRequestDocument } from '@/types/firestore';

// ─── DELETE /api/shifts/leave/[leaveId] ────────────────────────────────────
//
// Withdrawing a leave request. Two very different operations behind one verb:
//
// - A **pending or denied** request is just a row going away. Nobody has acted
//   on it, so nothing else changes and nobody is told.
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

    // Always refund the balance — it was decremented when the request was created.
    // Exception: if already denied, balance was already refunded by the deny action.
    const balanceField = leave.leaveType === 'paid' ? 'remainingPaidLeave' : 'remainingUnpaidLeave';
    const batch = adminDb.batch();
    batch.delete(leaveRef);
    if (leave.status !== 'denied') {
      batch.update(adminDb.collection('users').doc(leave.userId), {
        [balanceField]: FieldValue.increment(1),
      });
    }
    await batch.commit();
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
