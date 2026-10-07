import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import { queueDisputeNotice } from '@/lib/services/disputeNotices';
import { applyAdminVerdict } from '@/lib/services/disputeTransfer';
import { announceTierCrossings } from '@/lib/services/tierNotices';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ApprovalStatus } from '@/types/firestore';

/**
 * PATCH /api/disputes/[disputeId]/admin-approval
 * Sets AdminApproval on a dispute. Caller must have the 'ca-admin' page permission.
 * Body: { AdminApproval: 'Approved' | 'Rejected', reason? }
 *
 * On a v2 dispute an approval **transfers the claimed tips** to the filer —
 * see `applyAdminVerdict`. The response carries `transferResult` so the admin
 * sees what moved and what was skipped, in words.
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

    // One implementation of "what approving does", shared with the bulk bar:
    // a v2 approval transfers the claimed tips to the filer, partial success
    // recorded on the dispute; a v1 approval moves nothing, as it never did.
    // `resolvedAt` is stamped either way — it is what lets the filer's
    // dashboard say "decided in the last fortnight" rather than "filed" in it.
    const outcome = await applyAdminVerdict({ disputeId, verdict: AdminApproval, actorUid: token.uid });
    if (!outcome.found) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    // Queued, not sent: a team leader clearing a backlog decides many of one
    // person's disputes in a sitting, and each one notifying would be a phone
    // buzzing six times in a minute. The cron flushes the queue into a single
    // message once the reviewer has been quiet — see services/disputeNotices.ts.
    if (outcome.createdBy) {
      await queueDisputeNotice({
        stage: 'admin',
        outcome: AdminApproval === 'Approved' ? 'approved' : 'rejected',
        userId: outcome.createdBy,
        reason,
      });
    }

    // A transfer moves gross between two agents, so it can cross a tier.
    if (outcome.touched.length > 0) after(() => announceTierCrossings(outcome.touched));

    return NextResponse.json({ success: true, version: outcome.version, transferResult: outcome.transferResult });
  } catch (error) {
    console.error('[disputes admin-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update admin approval' }, { status: 500 });
  }
});
