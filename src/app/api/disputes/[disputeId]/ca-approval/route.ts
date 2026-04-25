import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
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

    addNotificationToBatch(
      batch,
      dispute.createdBy,
      CaApproval === 'Approved'
        ? notifications.disputeCaApproved(assignedToName)
        : notifications.disputeCaRejected(assignedToName, reason),
    );

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[disputes ca-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update CA approval' }, { status: 500 });
  }
});
