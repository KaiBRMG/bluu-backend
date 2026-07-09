import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { SMM_BONUS, checkSmmAccess } from '@/lib/services/smmService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * PATCH /api/smm/bonus/rounds/[roundId]/totals — admin Earnings edit.
 * Absolute overwrite of one user's payout (a manual override that may
 * intentionally diverge from the sum of their approved submissions).
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ roundId: string }>,
) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const { roundId } = await params;
    const body = await request.json() as { uid?: string; amount?: number };
    if (!body.uid || typeof body.amount !== 'number' || Number.isNaN(body.amount)) {
      return NextResponse.json({ error: 'uid and a numeric amount are required' }, { status: 400 });
    }

    const ref = adminDb.collection(SMM_BONUS).doc(roundId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    await ref.update({ [`userTotals.${body.uid}`]: body.amount });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/smm/bonus/rounds/:roundId/totals]', error);
    return NextResponse.json({ error: 'Failed to update payout' }, { status: 500 });
  }
});
