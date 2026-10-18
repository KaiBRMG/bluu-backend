/**
 * PUT    /api/ca-sales/[saleId]/transfer  `{ toUserId: string | null, reason }`
 * DELETE /api/ca-sales/[saleId]/transfer  `{ reason }`
 *
 * Who holds a sale, decided by an admin — Bluu Backend is the source of truth
 * for sales (documentation/buddyx.md §5).
 *
 * - **PUT** reassigns the sale from CA Admin → Sales: to an agent, or to nobody
 *   (`null`). Moving it to the agent BuddyX credits clears any transfer, so the
 *   sale matches BuddyX again. The move is a `transfer` (`kind: 'admin'`) that
 *   every later sync keeps.
 * - **DELETE** reverts a transfer (dispute or admin) — the escape hatch for a
 *   wrong approval. The sale returns to whoever BuddyX attributes it to now.
 *
 * `ca-admin` page permission — the tier that approves disputes, which move the
 * same money. Open months only, for both agents; never under an open dispute;
 * any source — Infloww history moves like a BuddyX sale. A reason is required
 * either way: it is shown on the ledger, written to the sale's `assignmentLog`,
 * and to the dispute when one is undone.
 * Tier notices for both agents run from `after()`. Uncached — a mutation.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { reassignSale, untransferSale } from '@/lib/services/disputeTransfer';
import { announceTierCrossings } from '@/lib/services/tierNotices';
import { getUserById } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';

const MAX_REASON = 500;

function readReason(body: unknown): string {
  return String((body as { reason?: unknown })?.reason ?? '').trim().slice(0, MAX_REASON);
}

export const PUT = withAuth(async (
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
    const raw = (parsed.body as { toUserId?: unknown }).toUserId;
    if (raw !== null && (typeof raw !== 'string' || raw.length === 0 || raw.length > 128)) {
      return NextResponse.json({ error: 'toUserId must be a user id or null.' }, { status: 400 });
    }
    const toUserId = raw as string | null;
    const reason = readReason(parsed.body);
    if (reason.length < 3) {
      return NextResponse.json({ error: 'Say why — it is shown on the ledger and recorded on the sale.' }, { status: 400 });
    }

    // Never trust the client's id: the target must be a real, active account
    // (rule 6 — archived users are not assignable).
    if (toUserId) {
      const target = await getUserById(toUserId);
      if (!target || target.isArchived) {
        return NextResponse.json({ error: 'That agent does not exist or is archived.' }, { status: 400 });
      }
    }

    const outcome = await reassignSale({ saleId, toUserId, actorUid: token.uid, reason });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

    after(() => announceTierCrossings(outcome.touched));
    return NextResponse.json({ success: true, disputeId: outcome.disputeId });
  } catch (err) {
    return handleApiError(err, 'ca-sales/[saleId]/transfer PUT');
  }
});

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
    const reason = readReason(parsed.body);
    if (!reason) {
      return NextResponse.json({ error: 'Say why — it is recorded on the sale and the dispute.' }, { status: 400 });
    }

    const outcome = await untransferSale({ saleId, actorUid: token.uid, reason });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

    after(() => announceTierCrossings(outcome.touched));
    return NextResponse.json({ success: true, disputeId: outcome.disputeId });
  } catch (err) {
    return handleApiError(err, 'ca-sales/[saleId]/transfer DELETE');
  }
});
