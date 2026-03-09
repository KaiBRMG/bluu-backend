import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import {
  createShift,
  getShiftsByUserAndRange,
} from '@/lib/services/shiftService';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ShiftDocument } from '@/types/firestore';

// ─── Serialise ────────────────────────────────────────────────────────

function serialiseShift(s: ShiftDocument) {
  return {
    shiftId:        s.shiftId,
    userId:         s.userId,
    startTime:      s.startTime.toDate().toISOString(),
    endTime:        s.endTime.toDate().toISOString(),
    wallClockStart: s.wallClockStart,
    wallClockEnd:   s.wallClockEnd,
    userTimezone:   s.userTimezone,
    isRecurring:    s.isRecurring,
    recurrence:     s.recurrence ? {
      ...s.recurrence,
      endDate: s.recurrence.endDate ? s.recurrence.endDate.toDate().toISOString() : null,
    } : null,
    seriesId:       s.seriesId,
    overrideDate:   s.overrideDate ? s.overrideDate.toDate().toISOString() : null,
    isDeleted:      s.isDeleted,
  };
}

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
    const { userId, startTime, endTime, wallClockStart, wallClockEnd, userTimezone, recurrence } = body;

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

    const shiftId = await createShift({
      userId,
      startTime: startMs,
      endTime: endMs,
      wallClockStart,
      wallClockEnd,
      userTimezone,
      createdBy: token.uid,
      recurrence: recurrence ?? null,
    });

    return NextResponse.json({ shiftId });
  } catch (err) {
    console.error('[shifts POST]', err);
    return NextResponse.json({ error: 'Failed to create shift' }, { status: 500 });
  }
});
