import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import { queueDisputeNotice } from '@/lib/services/disputeNotices';
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
    const denied = await checkPageAccess(token.uid, 'ca-admin');
    if (denied) return denied;

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

    // `resolvedAt` is what lets the filer's dashboard say "decided in the last
    // fortnight" rather than "filed in the last fortnight" — a dispute raised
    // in March and ruled on today is news, and `createdAt` cannot tell them so.
    await disputeRef.update({ AdminApproval, resolvedAt: FieldValue.serverTimestamp() });

    // Queued, not sent: a team leader clearing a backlog decides many of one
    // person's disputes in a sitting, and each one notifying would be a phone
    // buzzing six times in a minute. The cron flushes the queue into a single
    // message once the reviewer has been quiet — see services/disputeNotices.ts.
    await queueDisputeNotice({
      stage: 'admin',
      outcome: AdminApproval === 'Approved' ? 'approved' : 'rejected',
      userId: dispute.createdBy,
      reason,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[disputes admin-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update admin approval' }, { status: 500 });
  }
});
