import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
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

    batch.set(adminDb.collection('notifications').doc(), {
      userId: leave.userId,
      title: action === 'approve' ? '✅ Leave Request Approved' : '❗️Leave Request Denied',
      message: action === 'approve'
        ? `Your ${leaveLabel} leave request on ${dateStr} has been approved.`
        : `Your ${leaveLabel} leave request on ${dateStr} has been denied.`,
      type: action === 'approve' ? 'success' : 'alert',
      read: false,
      dismissedByUser: false,
      createdAt: FieldValue.serverTimestamp(),
      actionUrl: '/applications/time-tracking',
      announcement: false,
      announcementExpiry: null,
    });

    await batch.commit();

    // Invalidate user cache after batch commit so balance reads are fresh
    invalidateUserCache(leave.userId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[shifts/leave/approve POST]', err);
    return NextResponse.json({ error: 'Failed to process leave action' }, { status: 500 });
  }
});
