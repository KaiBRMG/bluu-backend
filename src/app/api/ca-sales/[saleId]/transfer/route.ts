/**
 * DELETE /api/ca-sales/[saleId]/transfer  `{ reason }`
 *
 * Revert a dispute's transfer — the escape hatch for a wrong approval, which no
 * longer has a CRM to undo it in. `ca-admin` page permission, the tier that
 * approved it; open months only, for both agents. The sale returns to whoever
 * BuddyX attributes it to now, and the dispute records who reverted it and why.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { untransferSale } from '@/lib/services/disputeTransfer';
import { announceTierCrossings } from '@/lib/services/tierNotices';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const DELETE = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ saleId: string }>,
) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const { saleId } = await params;
    const parsed = await readJsonBody(request, 2048);
    if (!parsed.ok) return parsed.response;
    const reason = String((parsed.body as { reason?: unknown }).reason ?? '').trim();
    if (!reason) {
      return NextResponse.json({ error: 'Say why — it is recorded on the dispute.' }, { status: 400 });
    }

    const outcome = await untransferSale({ saleId, actorUid: token.uid, reason: reason.slice(0, 500) });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

    after(() => announceTierCrossings(outcome.touched));
    return NextResponse.json({ success: true, disputeId: outcome.disputeId });
  } catch (err) {
    return handleApiError(err, 'ca-sales/[saleId]/transfer DELETE');
  }
});
