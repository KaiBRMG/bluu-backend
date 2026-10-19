import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { queueDisputeNotice } from '@/lib/services/disputeNotices';
import { applyVerdict } from '@/lib/services/disputeTransfer';
import { announceTierCrossings } from '@/lib/services/tierNotices';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ApprovalStatus } from '@/types/firestore';

/**
 * PATCH /api/disputes/[disputeId]/ca-approval
 * Body: { CaApproval: 'Approved' | 'Rejected', reason? }
 *
 * The holder's verdict — **and the only approval a dispute needs.** Since
 * 2026-10-19 an approval here moves the claimed sales to the filer at once
 * (`applyVerdict`, `via: 'ca'`); no admin step follows. Admins see the move on
 * CA Admin → Sales ("Moved by dispute") and can overturn it there.
 *
 * Authorisation is the assignment itself: only `assignedTo` may rule, and only
 * while the dispute is untouched — both re-checked inside the transaction,
 * because this moves money. An agent can only ever give away a sale they hold.
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

    const outcome = await applyVerdict({ disputeId, verdict: CaApproval, actorUid: token.uid, via: 'ca' });
    if (!outcome.found) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }
    if (outcome.conflict === 'not-assigned') {
      return NextResponse.json({ error: 'Access denied — you are not assigned to this dispute' }, { status: 403 });
    }
    if (outcome.conflict === 'decided') {
      return NextResponse.json({ error: 'This dispute has already been decided.' }, { status: 409 });
    }

    // Queued, not sent: an assigned CA works down their whole queue in one
    // sitting, so the decisions are coalesced into a single message a few
    // quiet minutes later — see services/disputeNotices.ts.
    if (outcome.createdBy) {
      const caller = await getUserById(token.uid);
      await queueDisputeNotice({
        stage: 'ca',
        outcome: CaApproval === 'Approved' ? 'approved' : 'rejected',
        userId: outcome.createdBy,
        actorName: caller?.displayName ?? 'Someone',
        reason,
      });
    }

    // A transfer moves gross between two agents, so it can cross a tier.
    if (outcome.touched.length > 0) after(() => announceTierCrossings(outcome.touched));

    return NextResponse.json({ success: true, version: outcome.version, transferResult: outcome.transferResult });
  } catch (error) {
    console.error('[disputes ca-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update CA approval' }, { status: 500 });
  }
});
