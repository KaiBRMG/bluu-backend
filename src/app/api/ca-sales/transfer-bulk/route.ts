/**
 * POST /api/ca-sales/transfer-bulk  `{ moves: [{ saleId, toUserId: string | null }], reason }`
 *
 * Several admin reassignments in one request, from CA Admin → Sales' selection
 * bar — "assign these 14 unassigned tips to Queen", or "give each of these to
 * the agent the shift schedule had on the account". Each move may name its own
 * target, so the schedule fix is one request however many agents it touches.
 *
 * Every move is exactly `PUT /api/ca-sales/[saleId]/transfer`: the same
 * `reassignSale` transaction, the same refusals (removed rows, an open
 * dispute, a finalised month), the same `assignmentLog` entry. Moves
 * run one after another — never in parallel — so two sales locked by the same
 * dispute never contend. A refusal skips that sale and is returned
 * (`refused[]`); it never undoes the others. Tier notices for every touched
 * agent-month go out **once**, from `after()`, rather than once per sale.
 *
 * `ca-admin` page permission, same as the single route. Every target is checked
 * to be a real, non-archived account in one field-masked `getAll` (rule 6, rule
 * 9). Uncached — a mutation.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { reassignSale } from '@/lib/services/disputeTransfer';
import { announceTierCrossings } from '@/lib/services/tierNotices';
import { adminDb } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

const MAX_MOVES = 100;
const MAX_REASON = 500;

interface Move {
  saleId: string;
  toUserId: string | null;
}

function readMoves(raw: unknown): Move[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MOVES) return null;
  const seen = new Set<string>();
  const moves: Move[] = [];
  for (const item of raw) {
    const saleId = (item as { saleId?: unknown })?.saleId;
    const toUserId = (item as { toUserId?: unknown })?.toUserId;
    if (typeof saleId !== 'string' || saleId.length === 0 || saleId.length > 128) return null;
    if (toUserId !== null && (typeof toUserId !== 'string' || toUserId.length === 0 || toUserId.length > 128)) return null;
    if (seen.has(saleId)) return null;
    seen.add(saleId);
    moves.push({ saleId, toUserId });
  }
  return moves;
}

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const parsed = await readJsonBody(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const moves = readMoves((parsed.body as { moves?: unknown })?.moves);
    if (!moves) {
      return NextResponse.json(
        { error: `moves must be 1–${MAX_MOVES} distinct { saleId, toUserId } pairs.` },
        { status: 400 },
      );
    }
    const reason = String((parsed.body as { reason?: unknown })?.reason ?? '').trim().slice(0, MAX_REASON);
    if (reason.length < 3) {
      return NextResponse.json({ error: 'Say why — it is shown on the ledger and recorded on each sale.' }, { status: 400 });
    }

    // Never trust the client's ids: every target must be a real, active account.
    const targets = [...new Set(moves.map(m => m.toUserId).filter((v): v is string => Boolean(v)))];
    if (targets.length > 0) {
      const snaps = await adminDb.getAll(...targets.map(id => adminDb.collection('users').doc(id)), { fieldMask: ['isArchived'] });
      if (snaps.some(snap => !snap.exists || snap.get('isArchived') === true)) {
        return NextResponse.json({ error: 'One of those agents does not exist or is archived.' }, { status: 400 });
      }
    }

    const moved: string[] = [];
    const refused: Array<{ saleId: string; error: string }> = [];
    const touched = new Set<string>();
    for (const move of moves) {
      const outcome = await reassignSale({ saleId: move.saleId, toUserId: move.toUserId, actorUid: token.uid, reason });
      if (outcome.ok) {
        moved.push(move.saleId);
        for (const pair of outcome.touched) touched.add(pair);
      } else {
        refused.push({ saleId: move.saleId, error: outcome.error });
      }
    }

    if (touched.size > 0) after(() => announceTierCrossings(touched));
    return NextResponse.json({ moved, refused });
  } catch (err) {
    return handleApiError(err, 'ca-sales/transfer-bulk POST');
  }
});
