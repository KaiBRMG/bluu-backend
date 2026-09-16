import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { sendTelegramNotification } from '@/lib/services/telegramService';
import { releaseOccurrenceForCoverage } from '@/lib/services/leaveCoverage';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LeaveRequestDocument } from '@/types/firestore';

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

    // Balance was already decremented at request time; no balance check needed on approve.

    // Format date in the user's timezone for the notification message
    const userTimezone = targetUser.timezone || 'UTC';
    const dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(leave.occurrenceStart));

    const leaveLabel = leave.leaveType === 'paid' ? 'paid' : 'unpaid';

    // Batch: update leave doc + (if approve) decrement balance + create notification
    const batch = adminDb.batch();

    batch.update(leaveRef, {
      status: action === 'approve' ? 'approved' : 'denied',
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: token.uid,
    });

    if (action === 'deny') {
      // Refund the balance that was decremented when the request was created
      const balanceField = leave.leaveType === 'paid' ? 'remainingPaidLeave' : 'remainingUnpaidLeave';
      batch.update(adminDb.collection('users').doc(leave.userId), {
        [balanceField]: FieldValue.increment(1),
      });
    }

    const content = action === 'approve'
      ? notifications.leaveApproved(leaveLabel, dateStr)
      : notifications.leaveDenied(leaveLabel, dateStr);
    addNotificationToBatch(batch, leave.userId, content);

    await batch.commit();
    await sendTelegramNotification([leave.userId], content);

    // Invalidate user cache after batch commit so balance reads are fresh
    invalidateUserCache(leave.userId);

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
