import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { sendTelegramNotification } from '@/lib/services/telegramService';
import { releaseOccurrenceForCoverage } from '@/lib/services/leaveCoverage';
import { LEAVE_BALANCE_FIELD, resolveLeaveBalances } from '@/lib/leave/leaveBalance';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LeaveRequestDocument, UserDocument } from '@/types/firestore';

/**
 * A refusal the admin needs to read, raised from inside the transaction.
 *
 * Distinguished from a genuine failure so the catch can answer 409 with the
 * message rather than 500 with a stack — "they have no days left" is an outcome,
 * not an error.
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
    const userTimezone = targetUser.timezone || 'UTC';
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

    // ── Approval is what spends the balance ──
    //
    // A **transaction**, not a batch, and this is the whole point of the change.
    // The old flow decremented at request time with a blind
    // `FieldValue.increment(-1)` after an unrelated read, so two requests landing
    // together both saw "1 left" and both decremented — a balance that could go
    // negative and a day nobody was entitled to. Reading the user document
    // *inside* the transaction is what makes the check and the write one
    // operation.
    //
    // Denial costs nothing, because nothing was ever taken: there is no refund
    // path left to get wrong.
    const balanceField = LEAVE_BALANCE_FIELD[leave.leaveType];

    try {
      await adminDb.runTransaction(async tx => {
        const userRef = adminDb.collection('users').doc(leave.userId);
        const freshLeave = await tx.get(leaveRef);

        // Re-checked inside the transaction: the status test above ran before it
        // opened, so two admins clicking Approve at once both passed it.
        if ((freshLeave.data() as LeaveRequestDocument | undefined)?.status !== 'pending') {
          throw new LeaveConflict('That request has already been decided.');
        }

        if (action === 'approve') {
          const userSnap = await tx.get(userRef);
          const balances = resolveLeaveBalances(userSnap.data() as UserDocument | undefined);
          const remaining = leave.leaveType === 'paid' ? balances.paid : balances.unpaid;

          // Refused rather than clamped. Approving leave the agent cannot afford
          // is a payroll decision — it either costs the company a day it did not
          // grant, or (clamped at zero) silently records an absence against a
          // balance that never moved. An admin who means to allow it can raise
          // the balance in CA Admin → Leave and approve again, which leaves a
          // trail; a clamp leaves none.
          if (remaining <= 0) {
            throw new LeaveConflict(
              `${targetUser.displayName ?? 'That agent'} has no ${leaveLabel} leave remaining. Adjust their balance in CA Admin → Leave to approve this.`,
            );
          }

          tx.update(userRef, { [balanceField]: remaining - 1 });
        }

        tx.update(leaveRef, {
          status: action === 'approve' ? 'approved' : 'denied',
          resolvedAt: FieldValue.serverTimestamp(),
          resolvedBy: token.uid,
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
