import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { safeTimezone } from '@/lib/utils/timezone';
import { sendTelegramNotification } from '@/lib/services/telegramService';
import { releaseOccurrenceForCoverage } from '@/lib/services/leaveCoverage';
import { computeLeaveBalance, leavePeriodOf, remainingAfterChange } from '@/lib/leave/leaveBalance';
import { recordLeaveLedgerEntry } from '@/lib/services/leaveLedger';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LeaveRequestDocument, UserDocument } from '@/types/firestore';

/**
 * A refusal the admin needs to read, raised from inside the transaction.
 *
 * Distinguished from a genuine failure so the catch can answer 409 with the
 * message rather than 500 with a stack — "already decided" is an outcome, not
 * an error.
 */
class LeaveConflict extends Error {}

// ─── POST /api/shifts/leave/[leaveId]/approve ─────────────────────────────

export const POST = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ leaveId: string }>,
) => {
  try {
    const { leaveId } = await params;
    const { action } = await request.json() as { action: 'approve' | 'deny' };

    if (action !== 'approve' && action !== 'deny') {
      return NextResponse.json({ error: 'Invalid action. Must be "approve" or "deny"' }, { status: 400 });
    }

    // Auth: caller must have shift-management page access
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Load leave request
    const leaveRef = adminDb.collection('leave_requests').doc(leaveId);
    const leaveDoc = await leaveRef.get();

    if (!leaveDoc.exists) {
      return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
    }

    const leave = leaveDoc.data() as LeaveRequestDocument;

    // Load target user (needed for balance check and notification timezone)
    const targetUser = await getUserById(leave.userId);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (leave.status !== 'pending') {
      // Re-deciding a resolved request would deduct a second day for the same
      // absence, or refund one that was never spent. The queue only offers the
      // action on pending rows, so this is a double-submit or a stale tab.
      return NextResponse.json(
        { error: `That request has already been ${leave.status}.` },
        { status: 409 },
      );
    }

    // Format date in the user's timezone for the notification message
    // Rule 9g: an unset timezone is '' and `Intl` throws on it.
    const userTimezone = safeTimezone(targetUser.timezone);
    const dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(leave.occurrenceStart));

    const leaveLabel = leave.leaveType === 'paid' ? 'paid' : 'unpaid';

    const content = action === 'approve'
      ? notifications.leaveApproved(leaveLabel, dateStr)
      : notifications.leaveDenied(leaveLabel, dateStr);

    // ── The balance follows the status ──
    //
    // A pending request already holds its day (`leaveBalance.ts`), so approving
    // moves nothing, and denying gives the day back by no longer counting. The
    // transaction only exists to make the status check and the ledger's
    // before/after one read.
    try {
      await adminDb.runTransaction(async tx => {
        const userRef = adminDb.collection('users').doc(leave.userId);
        const [freshLeaveSnap, userSnap, ownRequests] = await Promise.all([
          tx.get(leaveRef),
          tx.get(userRef),
          tx.get(adminDb.collection('leave_requests').where('userId', '==', leave.userId)),
        ]);
        const freshLeave = freshLeaveSnap.data() as LeaveRequestDocument | undefined;
        const freshUser = userSnap.data() as UserDocument | undefined;

        // Re-checked inside the transaction: the status test above ran before it
        // opened, so two admins clicking Approve at once both passed it.
        if (!freshLeave || freshLeave.status !== 'pending') {
          throw new LeaveConflict('That request has already been decided.');
        }

        const nextStatus = action === 'approve' ? 'approved' : 'denied';
        const requests = ownRequests.docs.map(d => d.data() as LeaveRequestDocument);
        const period = leavePeriodOf(leave.leaveType, leave.occurrenceStart);
        const before = computeLeaveBalance(freshUser, requests, leave.leaveType, period).remaining;
        const after = remainingAfterChange(before, freshLeave, { status: nextStatus });

        tx.update(leaveRef, {
          status: nextStatus,
          resolvedAt: FieldValue.serverTimestamp(),
          resolvedBy: token.uid,
        });
        recordLeaveLedgerEntry(tx, {
          leaveId: leave.leaveId,
          userId: leave.userId,
          leaveType: leave.leaveType,
          occurrenceStart: leave.occurrenceStart,
          action: nextStatus,
          before,
          after,
          actorUid: token.uid,
          period,
        });
      });
    } catch (txErr) {
      if (txErr instanceof LeaveConflict) {
        return NextResponse.json({ error: txErr.message }, { status: 409 });
      }
      throw txErr;
    }

    // The notification is outside the transaction on purpose: a transaction that
    // retries would write the notification once per attempt.
    const batch = adminDb.batch();
    addNotificationToBatch(batch, leave.userId, content);
    await batch.commit();
    await sendTelegramNotification([leave.userId], content);

    // Approving leave releases the shift in one step: the occurrence is
    // tombstoned and each creator the agent was covering is posted to the
    // Available Shifts board. Doing it here rather than as a separate admin
    // action is what stops an approved absence sitting with nobody covering it.
    //
    // Deliberately after the commit and deliberately non-fatal: the leave was
    // approved and the agent has been told, so a failure to release must not
    // turn into a 500 that makes an admin approve it twice. The response carries
    // the outcome so the UI can say what happened either way.
    let coverage: Awaited<ReturnType<typeof releaseOccurrenceForCoverage>> | null = null;
    if (action === 'approve') {
      try {
        coverage = await releaseOccurrenceForCoverage({
          shiftId: leave.shiftId,
          occurrenceStart: leave.occurrenceStart,
          userId: leave.userId,
          leaveId: leave.leaveId,
          actorUid: token.uid,
        });
      } catch (releaseErr) {
        console.error('[shifts/leave/approve] coverage release failed', releaseErr);
      }

      // Record which occurrence was actually released, so withdrawing this leave
      // restores that document rather than the (possibly stale) one the request
      // pinned. Same non-fatal posture as the release itself.
      if (coverage?.resolved) {
        try {
          await leaveRef.update({
            releasedShiftId: coverage.resolved.shiftId,
            releasedOccurrenceStart: coverage.resolved.occurrenceStart,
          });
        } catch (stampErr) {
          console.error('[shifts/leave/approve] failed to record released occurrence', stampErr);
        }
      }
    }

    return NextResponse.json({ success: true, coverage });
  } catch (err) {
    console.error('[shifts/leave/approve POST]', err);
    return NextResponse.json({ error: 'Failed to process leave action' }, { status: 500 });
  }
});
