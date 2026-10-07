import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import { queueDisputeNotice } from '@/lib/services/disputeNotices';
import { applyAdminVerdict } from '@/lib/services/disputeTransfer';
import { announceTierCrossings } from '@/lib/services/tierNotices';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ApprovalStatus } from '@/types/firestore';

/**
 * PATCH /api/disputes/bulk-approval
 *
 * Sets `AdminApproval` on many disputes at once. Caller must have the
 * `ca-admin` page permission — the same tier as the single-dispute route, since
 * this is that route's decision taken N times and nothing more.
 *
 * Body: `{ disputeIds: string[], AdminApproval: 'Approved' | 'Rejected', reason?: string }`
 *
 * **It is a loop over `applyAdminVerdict`**, the one implementation of what a
 * verdict does — on a v2 dispute an approval transfers the claimed tips, which
 * is a transaction per dispute and cannot be folded into one batch. What the
 * route still saves over N client calls is the notifications: **one queued
 * notice per filer** (a person with six of the ten disputes is told once,
 * about six), and **one** commission-tier recomputation for the whole set.
 *
 * Partial success is reported, not thrown: an id that has vanished since the
 * page was loaded is counted in `skipped` while the rest are still written. The
 * alternative — failing the whole set — would make a stale row block a
 * reviewer's entire screen.
 */

/**
 * Ceiling on one call. The admin table pages at 10, so this is already far
 * beyond any real selection; it exists so a malformed or hostile body cannot
 * turn one request into an unbounded run of transactions.
 */
const MAX_BULK = 100;

export const maxDuration = 120;

export const PATCH = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, 'ca-admin');
    if (denied) return denied;

    const body = await request.json();
    const { disputeIds, AdminApproval, reason } = body as {
      disputeIds: unknown;
      AdminApproval: ApprovalStatus;
      reason?: string;
    };

    if (AdminApproval !== 'Approved' && AdminApproval !== 'Rejected') {
      return NextResponse.json({ error: 'AdminApproval must be Approved or Rejected' }, { status: 400 });
    }

    if (!Array.isArray(disputeIds)) {
      return NextResponse.json({ error: 'disputeIds must be an array' }, { status: 400 });
    }

    const ids = [...new Set(disputeIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'disputeIds must contain at least one id' }, { status: 400 });
    }
    if (ids.length > MAX_BULK) {
      return NextResponse.json({ error: `Cannot process more than ${MAX_BULK} disputes at once` }, { status: 400 });
    }

    // How many disputes each filer is being told about, so the notice is queued
    // once per person rather than once per dispute.
    const countByFiler = new Map<string, number>();
    const touched = new Set<string>();
    let updated = 0;
    let transferred = 0;
    let transferSkipped = 0;

    for (const disputeId of ids) {
      const outcome = await applyAdminVerdict({ disputeId, verdict: AdminApproval, actorUid: token.uid });
      if (!outcome.found) continue;
      updated += 1;
      for (const pair of outcome.touched) touched.add(pair);
      transferred += outcome.transferResult?.transferred.length ?? 0;
      transferSkipped += outcome.transferResult?.skipped.length ?? 0;
      if (outcome.createdBy) countByFiler.set(outcome.createdBy, (countByFiler.get(outcome.createdBy) ?? 0) + 1);
    }

    if (updated === 0) {
      return NextResponse.json({ error: 'None of those disputes exist' }, { status: 404 });
    }

    // Queued after the writes, never before: the notice must describe work that
    // is actually written. `queueDisputeNotice` never throws, so a queue failure
    // cannot undo a decision the reviewer can already see.
    await Promise.all(
      [...countByFiler].map(([userId, count]) =>
        queueDisputeNotice({
          stage: 'admin',
          outcome: AdminApproval === 'Approved' ? 'approved' : 'rejected',
          userId,
          reason,
          count,
        }),
      ),
    );
    if (touched.size > 0) after(() => announceTierCrossings(touched));

    return NextResponse.json({
      success: true,
      updated,
      skipped: ids.length - updated,
      transferred,
      transferSkipped,
    });
  } catch (error) {
    console.error('[disputes bulk-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update disputes' }, { status: 500 });
  }
});
