import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { invalidateUserCache } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LeaveRequestDocument } from '@/types/firestore';

// ─── DELETE /api/shifts/leave/[leaveId] ────────────────────────────────────

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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[shifts/leave DELETE]', err);
    return NextResponse.json({ error: 'Failed to cancel leave request' }, { status: 500 });
  }
});
