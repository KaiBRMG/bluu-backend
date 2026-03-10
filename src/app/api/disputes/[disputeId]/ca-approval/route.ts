import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ApprovalStatus } from '@/types/firestore';

/**
 * PATCH /api/disputes/[disputeId]/ca-approval
 * Sets CaApproval on a dispute. Caller must be the assignedTo user.
 * Body: { CaApproval: 'Approved' | 'Rejected' }
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ disputeId: string }> | { disputeId: string },
) => {
  try {
    const { disputeId } = await Promise.resolve(params);
    const body = await request.json();
    const { CaApproval, reason } = body as { CaApproval: ApprovalStatus; reason?: string };

    if (CaApproval !== 'Approved' && CaApproval !== 'Rejected') {
      return NextResponse.json({ error: 'CaApproval must be Approved or Rejected' }, { status: 400 });
    }

    const disputeRef = adminDb.collection('disputes').doc(disputeId);
    const disputeDoc = await disputeRef.get();
    if (!disputeDoc.exists) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const dispute = disputeDoc.data()!;
    if (dispute.assignedTo !== token.uid) {
      return NextResponse.json({ error: 'Access denied — you are not assigned to this dispute' }, { status: 403 });
    }

    const callerUser = await getUserById(token.uid);
    const assignedToName = callerUser?.displayName ?? 'Someone';

    const batch = adminDb.batch();

    batch.update(disputeRef, { CaApproval });

    const rejectBase = `${assignedToName} has rejected your dispute! Please contact them privately to settle your dispute.`;
    const notifMessage = CaApproval === 'Approved'
      ? `${assignedToName} has approved your dispute! It will now be passed to your team leader for approval.`
      : reason ? `${rejectBase} REASON: ${reason}` : rejectBase;

    batch.set(adminDb.collection('notifications').doc(), {
      userId: dispute.createdBy,
      title: CaApproval === 'Approved' ? 'Dispute Partially Approved' : 'Dispute Rejected',
      message: notifMessage,
      type: CaApproval === 'Approved' ? 'success' : 'alert',
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
    console.error('[disputes ca-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update CA approval' }, { status: 500 });
  }
});
