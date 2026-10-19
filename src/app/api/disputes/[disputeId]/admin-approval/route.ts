import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import { queueDisputeNotice } from '@/lib/services/disputeNotices';
import { applyVerdict } from '@/lib/services/disputeTransfer';
import { announceTierCrossings } from '@/lib/services/tierNotices';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ApprovalStatus } from '@/types/firestore';

/** Ceiling on a stored reason. The reason bars cap lower; this guards the API. */
const REASON_MAX = 200;

/**
 * PATCH /api/disputes/[disputeId]/admin-approval
 * Body: { AdminApproval: 'Approved' | 'Rejected', reason? }
 * Caller must have the `ca-admin` page permission.
 *
 * The admin is no longer a second approval (`applyVerdict`). This route is for:
 * - **a claim on an unassigned sale** (`No One`) — there is no holder to rule;
 * - **ruling in a holder's place** on a dispute still open;
 * - **overturning** a decided one: Rejected on an approved dispute gives its
 *   transfers back. An overturn **requires a reason** — it reverses money an
 *   agent was already told they have — and the reason is recorded on it.
 *
 * The response carries `transferResult` so the admin sees what moved and what
 * was skipped, in words.
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
    const { AdminApproval, reason: rawReason } = body as { AdminApproval: ApprovalStatus; reason?: unknown };
    const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, REASON_MAX) : '';

    if (AdminApproval !== 'Approved' && AdminApproval !== 'Rejected') {
      return NextResponse.json({ error: 'AdminApproval must be Approved or Rejected' }, { status: 400 });
    }

    // `resolvedAt` is stamped either way — it is what lets the filer's
    // dashboard say "decided in the last fortnight" rather than "filed" in it.
    const outcome = await applyVerdict({
      disputeId,
      verdict: AdminApproval,
      actorUid: token.uid,
      via: 'admin',
      reason: reason || undefined,
    });
    if (!outcome.found) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }
    if (outcome.conflict === 'reason-required') {
      return NextResponse.json({ error: 'Say why this move is being overturned.' }, { status: 400 });
    }

    // Queued, not sent — coalesced per filer by the cron (services/disputeNotices.ts).
    if (outcome.createdBy) {
      await queueDisputeNotice({
        stage: 'admin',
        outcome: AdminApproval === 'Approved' ? 'approved' : 'rejected',
        userId: outcome.createdBy,
        reason: reason || undefined,
      });
    }

    // A transfer (or its reversal) moves gross between two agents, so it can cross a tier.
    if (outcome.touched.length > 0) after(() => announceTierCrossings(outcome.touched));

    return NextResponse.json({ success: true, version: outcome.version, transferResult: outcome.transferResult });
  } catch (error) {
    console.error('[disputes admin-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update admin approval' }, { status: 500 });
  }
});
