/**
 * POST   /api/ca-coverage/claim   { offerId, note? }  — put my name down
 * DELETE /api/ca-coverage/claim?offerId=…             — take it back
 *
 * A claim is an expression of interest, not a booking: the admin assigns.
 * Claiming for someone else is impossible by construction — the uid comes from
 * the token and is never read from the body.
 *
 * ## What a claim checks
 *
 * The offer is still open, it is not the claimant's own released shift, and its
 * window has not **ended** — it is claimable while under way, because cover that
 * starts late is still cover. There is **no cap on accounts** (removed
 * 2026-10-20): an agent may put their name down for as much overtime as they
 * like, and the admin who assigns sees each claimant's load on Coverage → To
 * assign. Enforced here rather than only in the UI: a client-side guard is not a
 * guard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { claimOffer, withdrawClaim, getOffer } from '@/lib/services/caCoverageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { offerId, note } = (await request.json()) as { offerId?: string; note?: string };
    if (!offerId || typeof offerId !== 'string') {
      return NextResponse.json({ error: 'offerId is required' }, { status: 400 });
    }

    const offer = await getOffer(offerId);
    if (!offer) return NextResponse.json({ error: 'This shift is no longer listed.' }, { status: 404 });
    if (offer.status !== 'available') {
      return NextResponse.json({ error: 'This shift has already been assigned.' }, { status: 409 });
    }
    if (offer.originalUserId === token.uid) {
      return NextResponse.json({ error: 'You cannot cover your own released shift.' }, { status: 400 });
    }
    if (offer.windowEnd <= Date.now()) {
      return NextResponse.json({ error: 'This shift has already ended.' }, { status: 400 });
    }

    await claimOffer(offerId, token.uid, typeof note === 'string' ? note.trim().slice(0, 280) : undefined);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to claim';
    if (/no longer listed|already been assigned/.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return handleApiError(err, 'ca-coverage/claim POST');
  }
});

export const DELETE = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const offerId = new URL(request.url).searchParams.get('offerId');
    if (!offerId) return NextResponse.json({ error: 'offerId is required' }, { status: 400 });

    const offer = await getOffer(offerId);
    if (offer?.status === 'assigned' && offer.assignedTo === token.uid) {
      return NextResponse.json(
        { error: 'This is already assigned to you. Ask an admin to release it.' },
        { status: 409 },
      );
    }

    await withdrawClaim(offerId, token.uid);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'ca-coverage/claim DELETE');
  }
});
