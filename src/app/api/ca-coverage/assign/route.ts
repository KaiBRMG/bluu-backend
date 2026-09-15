/**
 * POST   /api/ca-coverage/assign   { offerId, userId, forceInShift?, windowStart?, windowEnd? }
 * DELETE /api/ca-coverage/assign?offerId=…[&cancel=true]
 *
 * The admin's half of the coverage flow: give an offer to an agent, which
 * creates the shift that pays for it.
 *
 * The in-shift/outside-shift decision is made from the roster rather than asked
 * of the admin — it is the difference between "sales only" and "sales plus paid
 * hours", and it is derivable. `forceInShift` exists for the case the calendar
 * cannot see, such as an agent agreeing to stay on past their shift end.
 *
 * Nobody is notified yet: coverage notifications are held back until the
 * subsystem has run in production (see documentation/ca-salary.md §11), so an
 * admin assigning cover should tell the agent themselves. The board still shows
 * the outcome to anyone who opens it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { assignOffer, getOffer, unassignOffer, cancelOffer } from '@/lib/services/caCoverageService';
import { getUserById } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { safeTimezone } from '@/lib/utils/timezone';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const body = (await request.json()) as {
      offerId?: string;
      userId?: string;
      forceInShift?: boolean;
      windowStart?: number;
      windowEnd?: number;
    };

    if (!body.offerId || !body.userId) {
      return NextResponse.json({ error: 'offerId and userId are required' }, { status: 400 });
    }

    const offer = await getOffer(body.offerId);
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    if (offer.status === 'assigned') {
      return NextResponse.json({ error: 'This offer is already assigned.' }, { status: 409 });
    }
    if (body.userId === offer.originalUserId) {
      return NextResponse.json(
        { error: 'That is the agent whose absence released this account.' },
        { status: 400 },
      );
    }

    const assignee = await getUserById(body.userId);
    if (!assignee || assignee.isArchived) {
      return NextResponse.json({ error: 'That user is not available.' }, { status: 400 });
    }

    // A custom window must still be a window — a zero or inverted range would
    // create a shift that pays nothing and reads as a bug on the calendar.
    if (body.windowStart !== undefined || body.windowEnd !== undefined) {
      const start = body.windowStart ?? offer.windowStart;
      const end = body.windowEnd ?? offer.windowEnd;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return NextResponse.json({ error: 'The overtime window must end after it starts.' }, { status: 400 });
      }
      if (end - start > 24 * 3_600_000) {
        return NextResponse.json({ error: 'An overtime shift cannot exceed 24 hours.' }, { status: 400 });
      }
    }

    const result = await assignOffer({
      offerId: body.offerId,
      userId: body.userId,
      actorUid: token.uid,
      userTimezone: safeTimezone(assignee.timezone),
      forceInShift: body.forceInShift,
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
    });

    return NextResponse.json({
      success: true,
      shiftId: result.shiftId,
      inShift: result.inShift,
      merged: result.merged,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/already assigned|not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return handleApiError(err, 'ca-coverage/assign POST');
  }
});

export const DELETE = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const offerId = searchParams.get('offerId');
    if (!offerId) return NextResponse.json({ error: 'offerId is required' }, { status: 400 });

    // `cancel` withdraws the account from the board entirely; the default puts
    // it back up for someone else. Both delete the shift the assignment created,
    // which is the write that stops the wage.
    if (searchParams.get('cancel') === 'true') await cancelOffer(offerId);
    else await unassignOffer(offerId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'ca-coverage/assign DELETE');
  }
});
