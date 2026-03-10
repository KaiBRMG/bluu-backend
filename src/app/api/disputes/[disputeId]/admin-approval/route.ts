import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ApprovalStatus } from '@/types/firestore';

/**
 * PATCH /api/disputes/[disputeId]/admin-approval
 * Sets AdminApproval on a dispute. Caller must have the 'ca-admin' page permission.
 * Body: { AdminApproval: 'Approved' | 'Rejected' }
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ disputeId: string }> | { disputeId: string },
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('ca-admin')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { disputeId } = await Promise.resolve(params);
    const body = await request.json();
    const { AdminApproval, reason } = body as { AdminApproval: ApprovalStatus; reason?: string };

    if (AdminApproval !== 'Approved' && AdminApproval !== 'Rejected') {
      return NextResponse.json({ error: 'AdminApproval must be Approved or Rejected' }, { status: 400 });
    }

    const disputeRef = adminDb.collection('disputes').doc(disputeId);
    const disputeDoc = await disputeRef.get();
    if (!disputeDoc.exists) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const dispute = disputeDoc.data()!;

    const batch = adminDb.batch();

    batch.update(disputeRef, { AdminApproval });

    const rejectBase = `❗️Your dispute has been Rejected, please resubmit your dispute or contact your team leader!`;
    const notifMessage = AdminApproval === 'Approved'
      ? `Good news 🎉 your dispute has been approved! It will be added to your Earnings Report soon.`
      : reason ? `${rejectBase} REASON: ${reason}` : rejectBase;

    batch.set(adminDb.collection('notifications').doc(), {
      userId: dispute.createdBy,
      title: AdminApproval === 'Approved' ? 'Dispute Approved' : 'Dispute Rejected',
      message: notifMessage,
      type: AdminApproval === 'Approved' ? 'success' : 'alert',
      read: false,
      dismissedByUser: false,
      createdAt: FieldValue.serverTimestamp(),
      actionUrl: '/ca-portal/disputes',
      announcement: false,
      announcementExpiry: null,
    });

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[disputes admin-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update admin approval' }, { status: 500 });
  }
});
