import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { queueDisputeNotice } from '@/lib/services/disputeNotices';
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

    // A CA *rejection* is terminal for the filer — they refile rather than
    // wait — so it stamps `resolvedAt` like an admin verdict does. An approval
    // does not: the dispute is still moving, and stamping it here would
    // announce "decided" for something that has not been.
    await disputeRef.update(
      CaApproval === 'Rejected'
        ? { CaApproval, resolvedAt: FieldValue.serverTimestamp() }
        : { CaApproval },
    );

    // Queued, not sent: an assigned CA works down their whole queue in one
    // sitting, so the decisions are coalesced into a single message a few
    // quiet minutes later — see services/disputeNotices.ts.
    await queueDisputeNotice({
      stage: 'ca',
      outcome: CaApproval === 'Approved' ? 'approved' : 'rejected',
      userId: dispute.createdBy,
      actorName: assignedToName,
      reason,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[disputes ca-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update CA approval' }, { status: 500 });
  }
});
