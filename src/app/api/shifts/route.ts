import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import {
  createShift,
  getShiftsByUserAndRange,
} from '@/lib/services/shiftService';
import type { DecodedIdToken } from 'firebase-admin/auth';
// The shared serialiser, not a local copy: it is what carries `creatorIds`
// through to the salary engine, and a second hand-rolled one here is exactly how
// the assignment would silently stop reaching the client.
import { serialiseShift } from '@/lib/utils/shiftSerialise';
import { normaliseAccountIds, intersectOvertimeIds } from '@/lib/services/creatorAccountService';
import { queueOvertimeAssignedForShift } from '@/lib/services/coverageNotices';

// ─── GET /api/shifts ─────────────────────────────────────────────────
// ?userId=uid&start=ISO&end=ISO

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') ?? token.uid;
    const startStr     = searchParams.get('start');
    const endStr       = searchParams.get('end');

    if (!startStr || !endStr) {
      return NextResponse.json({ error: 'start and end required' }, { status: 400 });
    }

    // Non-self requests require shift-management page access
    if (targetUserId !== token.uid) {
      const caller = await getUserById(token.uid);
      if (!caller?.permittedPageIds?.includes('shift-management')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    const startMs = new Date(startStr).getTime();
    const endMs   = new Date(endStr).getTime();

    if (isNaN(startMs) || isNaN(endMs)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const shifts = await getShiftsByUserAndRange(targetUserId, startMs, endMs);

    return NextResponse.json({ shifts: shifts.map(serialiseShift) });
  } catch (err) {
    console.error('[shifts GET]', err);
    return NextResponse.json({ error: 'Failed to fetch shifts' }, { status: 500 });
  }
});

// ─── POST /api/shifts ────────────────────────────────────────────────

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, startTime, endTime, wallClockStart, wallClockEnd, userTimezone, recurrence, creatorIds, overtimeCreatorIds } = body;

    if (!userId || !startTime || !endTime || !wallClockStart || !wallClockEnd || !userTimezone) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const startMs = new Date(startTime).getTime();
    const endMs   = new Date(endTime).getTime();

    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      return NextResponse.json({ error: 'Invalid startTime/endTime' }, { status: 400 });
    }

    // Validate user exists and has access to the time-tracking page
    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (!targetUser.permittedPageIds?.includes('time-tracking')) {
      return NextResponse.json({ error: 'User does not have time tracking enabled' }, { status: 400 });
    }

    // Creator assignment is validated against the live roster rather than
    // trusted: an id that no longer resolves would set a wage tier from an
    // account nobody works, and the count is what pays the agent.
    const assigned = await normaliseAccountIds(creatorIds);
    if (assigned.invalid.length > 0) {
      return NextResponse.json(
        {
          // Almost always a stale picker: the account was archived or deleted
          // while this page had the roster cached. Say so, rather than printing
          // a raw id the admin cannot look up.
          error:
            `${assigned.invalid.length === 1 ? 'An account' : 'Some accounts'} in this assignment no longer exist` +
            ` (${assigned.invalid.join(', ')}). They may have been archived or deleted — reload the page and pick again.`,
        },
        { status: 400 },
      );
    }

    // Constrained to the assignment rather than trusted: this set is
    // *subtracted* from the wage tier, so a stray id would underpay.
    const overtimeIds = intersectOvertimeIds(assigned.accountIds, overtimeCreatorIds);

    const shiftId = await createShift({
      userId,
      startTime: startMs,
      endTime: endMs,
      wallClockStart,
      wallClockEnd,
      userTimezone,
      createdBy: token.uid,
      recurrence: recurrence ?? null,
      creatorIds: assigned.accountIds,
      overtimeCreatorIds: overtimeIds,
    });

    // Assigning overtime here is the same act as assigning it from the Coverage
    // board, so it sends the same notice. After the write and non-fatal: the
    // shift exists and an admin must not be told the save failed because a
    // message could not be queued.
    //
    // A recurring series is announced by its **first** occurrence's date. That
    // understates a standing arrangement rather than misstating it, and the
    // copy already sends the agent to their calendar for the full picture.
    await queueOvertimeAssignedForShift({
      userId,
      occurrenceMs: startMs,
      addedCreatorIds: overtimeIds,
    });

    return NextResponse.json({ shiftId });
  } catch (err) {
    console.error('[shifts POST]', err);
    return NextResponse.json({ error: 'Failed to create shift' }, { status: 500 });
  }
});
