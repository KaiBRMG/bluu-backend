import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import {
  createShift,
  updateShift,
  deleteShift,
  deleteShiftSeries,
  createOccurrenceOverride,
  deleteOccurrence,
  truncateSeriesAt,
} from '@/lib/services/shiftService';
import { adminDb } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ShiftDocument } from '@/types/firestore';

// ─── PUT /api/shifts/[shiftId] ───────────────────────────────────────

export const PUT = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ shiftId: string }> | { shiftId: string },
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { shiftId } = await Promise.resolve(params);
    const body = await request.json();

    // Fetch the existing shift to validate it exists and get series info
    const shiftDoc = await adminDb.collection('shifts').doc(shiftId).get();
    if (!shiftDoc.exists) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }
    const existing = shiftDoc.data() as ShiftDocument;

    const {
      userId, startTime, endTime, wallClockStart, wallClockEnd, userTimezone, recurrence,
      // Recurrence scope modifiers
      saveMode,       // 'single' | 'future' — for recurring edits
      overrideDate,   // ISO string — required when saveMode is 'single' or 'future'
    } = body;

    const startMs = startTime ? new Date(startTime).getTime() : null;
    const endMs   = endTime   ? new Date(endTime).getTime()   : null;

    if (startMs !== null && endMs !== null && endMs <= startMs) {
      return NextResponse.json({ error: 'endTime must be after startTime' }, { status: 400 });
    }

    // Validate target user if changing userId
    if (userId && userId !== existing.userId) {
      const targetUser = await getUserById(userId);
      if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
      if (!targetUser.permittedPageIds?.includes('time-tracking')) return NextResponse.json({ error: 'User does not have time tracking enabled' }, { status: 400 });
    }

    if (existing.isRecurring && saveMode === 'single') {
      // Create an override doc for this specific occurrence
      if (!overrideDate) {
        return NextResponse.json({ error: 'overrideDate required for single-occurrence edit' }, { status: 400 });
      }
      const overrideDateMs = new Date(overrideDate).getTime();

      await createOccurrenceOverride(
        existing.seriesId ?? shiftId, // if this is already an override, link to the root
        overrideDateMs,
        {
          userId:         userId         ?? existing.userId,
          startTime:      startMs        ?? existing.startTime.toMillis(),
          endTime:        endMs          ?? existing.endTime.toMillis(),
          wallClockStart: wallClockStart ?? existing.wallClockStart,
          wallClockEnd:   wallClockEnd   ?? existing.wallClockEnd,
          userTimezone:   userTimezone   ?? existing.userTimezone,
          createdBy:      token.uid,
          recurrence:     null,
        },
      );
    } else if (existing.isRecurring && saveMode === 'future') {
      // Truncate the existing series at the overrideDate, then create a new root shift
      if (!overrideDate) {
        return NextResponse.json({ error: 'overrideDate required for future edit' }, { status: 400 });
      }
      const overrideDateMs = new Date(overrideDate).getTime();
      const rootId = existing.seriesId ?? shiftId;

      await truncateSeriesAt(rootId, overrideDateMs);

      // Create a new root recurring shift starting from the overrideDate
      await createShift({
        userId:         userId         ?? existing.userId,
        startTime:      startMs        ?? existing.startTime.toMillis(),
        endTime:        endMs          ?? existing.endTime.toMillis(),
        wallClockStart: wallClockStart ?? existing.wallClockStart,
        wallClockEnd:   wallClockEnd   ?? existing.wallClockEnd,
        userTimezone:   userTimezone   ?? existing.userTimezone,
        createdBy:      token.uid,
        recurrence:     recurrence !== undefined ? recurrence : existing.recurrence,
      });
    } else {
      // Plain update (non-recurring, or updating the whole series)
      await updateShift(shiftId, {
        ...(userId         !== undefined && { userId }),
        ...(startMs        !== null      && { startTime: startMs }),
        ...(endMs          !== null      && { endTime: endMs }),
        ...(wallClockStart !== undefined && { wallClockStart }),
        ...(wallClockEnd   !== undefined && { wallClockEnd }),
        ...(userTimezone   !== undefined && { userTimezone }),
        ...('recurrence' in body        && { recurrence: body.recurrence }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[shifts PUT]', err);
    return NextResponse.json({ error: 'Failed to update shift' }, { status: 500 });
  }
});

// ─── DELETE /api/shifts/[shiftId] ────────────────────────────────────
// ?mode=single|future|series&overrideDate=ISO(required for single/future)

export const DELETE = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ shiftId: string }> | { shiftId: string },
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { shiftId } = await Promise.resolve(params);
    const { searchParams } = new URL(request.url);
    const mode           = searchParams.get('mode') ?? 'single';
    const overrideDateStr = searchParams.get('overrideDate');

    const shiftDoc = await adminDb.collection('shifts').doc(shiftId).get();
    if (!shiftDoc.exists) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }
    const existing = shiftDoc.data() as ShiftDocument;

    if (mode === 'series') {
      const rootId = existing.seriesId ?? shiftId;
      await deleteShiftSeries(rootId);
    } else if (mode === 'future') {
      // Truncate series so no occurrences exist from overrideDate onward
      if (!overrideDateStr) {
        return NextResponse.json({ error: 'overrideDate required for future delete' }, { status: 400 });
      }
      const overrideDateMs = new Date(overrideDateStr).getTime();
      const rootId = existing.seriesId ?? shiftId;
      await truncateSeriesAt(rootId, overrideDateMs);
    } else {
      // mode === 'single'
      if (existing.isRecurring) {
        // Recurring: create a tombstone override for this specific occurrence
        if (!overrideDateStr) {
          return NextResponse.json({ error: 'overrideDate required for single occurrence delete' }, { status: 400 });
        }
        const overrideDateMs = new Date(overrideDateStr).getTime();
        const rootId = existing.seriesId ?? shiftId;
        await deleteOccurrence(
          rootId,
          overrideDateMs,
          existing.userId,
          token.uid,
          existing.userTimezone,
        );
      } else {
        // One-time or override doc — just delete the document
        await deleteShift(shiftId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[shifts DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete shift' }, { status: 500 });
  }
});
