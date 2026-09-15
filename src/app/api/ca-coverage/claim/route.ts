/**
 * POST   /api/ca-coverage/claim   { offerId, note? }  — put my name down
 * DELETE /api/ca-coverage/claim?offerId=…             — take it back
 *
 * A claim is an expression of interest, not a booking: the admin assigns.
 * Claiming for someone else is impossible by construction — the uid comes from
 * the token and is never read from the body.
 *
 * ## The two limits
 *
 * `shift.md` caps an agent at 5 accounts during their own shift and 4 outside
 * it, and requires a day's notice. Both are enforced here rather than only in
 * the UI: a claim is the moment the rule has to hold, and a client-side guard is
 * not a guard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  claimOffer,
  withdrawClaim,
  getOffer,
  getOffers,
  findCoveringShift,
} from '@/lib/services/caCoverageService';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { dayKeyRange } from '@/lib/salary/salaryDate';
import type { ShiftDocument } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** Accounts an agent may work at once — inside their own shift, and outside it. */
const MAX_ACCOUNTS_IN_SHIFT = 5;
const MAX_ACCOUNTS_OUTSIDE_SHIFT = 4;
/** Overtime must be claimed at least this far ahead. */
const MIN_NOTICE_MS = 24 * 60 * 60 * 1000;

/**
 * Accounts this agent is already committed to on a day: every non-deleted
 * shift's assignments, plus every offer already assigned to them.
 */
async function accountsCommittedOn(userId: string, day: string): Promise<Set<string>> {
  const [dayStart, dayEnd] = dayKeyRange(day);

  const snap = await adminDb
    .collection('shifts')
    .where('userId', '==', userId)
    .where('startTime', '>=', Timestamp.fromMillis(dayStart - 12 * 3_600_000))
    .where('startTime', '<=', Timestamp.fromMillis(dayEnd))
    .get();

  const accounts = new Set<string>();
  for (const doc of snap.docs) {
    const shift = doc.data() as ShiftDocument;
    if (shift.isDeleted) continue;
    for (const id of shift.creatorIds ?? []) accounts.add(id);
  }
  return accounts;
}

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
    if (offer.windowStart - Date.now() < MIN_NOTICE_MS) {
      return NextResponse.json(
        { error: 'Overtime must be claimed at least a day in advance. Ask an admin to assign it directly.' },
        { status: 400 },
      );
    }

    // The cap counts what the agent is already committed to, plus everything
    // else they have claimed for that day and not yet been assigned — otherwise
    // five separate claims each pass the check individually and blow the cap
    // the moment an admin approves them.
    const covering = await findCoveringShift(token.uid, offer.windowStart, offer.windowEnd);
    const limit = covering ? MAX_ACCOUNTS_IN_SHIFT : MAX_ACCOUNTS_OUTSIDE_SHIFT;

    const committed = await accountsCommittedOn(token.uid, offer.day);
    const sameDayOffers = await getOffers({ fromDay: offer.day, toDay: offer.day, status: 'available' });
    const alsoClaimed = new Set(
      sameDayOffers
        .filter(o => o.offerId !== offerId && o.claims.some(c => c.userId === token.uid))
        .map(o => o.creatorId),
    );

    const projected = new Set([...committed, ...alsoClaimed, offer.creatorId]).size;
    if (projected > limit) {
      return NextResponse.json(
        {
          error: covering
            ? `That would put you on ${projected} accounts during your shift. The limit is ${limit}.`
            : `That would put you on ${projected} accounts outside your shift. The limit is ${limit}.`,
        },
        { status: 400 },
      );
    }

    await claimOffer(offerId, token.uid, typeof note === 'string' ? note.trim().slice(0, 280) : undefined);
    return NextResponse.json({ success: true, inShift: covering !== null });
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
