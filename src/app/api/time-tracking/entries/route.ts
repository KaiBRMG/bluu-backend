import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getLedgerEntriesByDateRange } from '@/lib/services/activeSessionService';
import { sessionToSegments } from '@/lib/utils/sessionSegments';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { SegmentRow, TimesheetSessionPayload } from '@/lib/utils/sessionSegments';

import { getDayBoundsUTCDates } from '@/lib/utils/timezone';

// ─── Route handler ───────────────────────────────────────────────────

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const startDateStr = searchParams.get('startDate');
    const endDateStr   = searchParams.get('endDate');
    // Viewer's IANA timezone — used to interpret calendar dates correctly.
    // Defaults to UTC so the API stays backward-compatible.
    const viewerTimezone = searchParams.get('timezone') || 'UTC';

    if (!startDateStr || !endDateStr) {
      return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const userId = targetUserId || token.uid;

    if (userId !== token.uid) {
      const caller = await getUserById(token.uid);
      if (!caller?.permittedPageIds?.includes('shift-management')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Interpret the date strings as calendar-day boundaries in the viewer's timezone,
    // so that e.g. "4 March" in GMT+2 correctly maps to UTC 2026-03-03T22:00 – 2026-03-04T21:59.
    const startBounds = getDayBoundsUTCDates(startDateStr, viewerTimezone);
    const endBounds   = getDayBoundsUTCDates(endDateStr,   viewerTimezone);
    const startDate = startBounds.start;
    const endDate   = endBounds.end;

    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 32 || diffDays < 0) {
      return NextResponse.json({ error: 'Date range must be 0-31 days' }, { status: 400 });
    }

    const [newEntries, targetUser] = await Promise.all([
      getLedgerEntriesByDateRange(userId, startDate, endDate),
      getUserById(userId),
    ]);

    // Decompose each session's event log into segment rows
    const allRows: SegmentRow[] = newEntries.flatMap(e =>
      sessionToSegments(e.id, e.data),
    );

    // Sort by createdTime ascending
    allRows.sort((a, b) =>
      new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime(),
    );

    // Raw session records for the walkthrough dialog. These are the SAME ledger
    // docs already fetched above — Firestore bills per document, not per field,
    // so carrying the event log through costs zero extra reads. Fetching it
    // on click instead would add a read per dialog open for no benefit.
    const sessions: TimesheetSessionPayload[] = newEntries.map(({ id, data }) => ({
      sessionId: id,
      startTime: data.startTime.toDate().toISOString(),
      endTime: data.endTime.toDate().toISOString(),
      status: data.status,
      didNotClockOut: data.didNotClockOut === true,
      isManual: data.isManual === true,
      workingSeconds: data.workingSeconds ?? 0,
      idleSeconds: data.idleSeconds ?? 0,
      breakSeconds: data.breakSeconds ?? 0,
      pauseSeconds: data.pauseSeconds ?? 0,
      events: (data.eventLog ?? []).map(e => (
        e.meta ? { type: e.type, timestamp: e.timestamp, meta: e.meta }
               : { type: e.type, timestamp: e.timestamp }
      )),
    }));

    return NextResponse.json({
      entries: allRows,
      sessions,
      timezone:        targetUser?.timezone        || 'UTC',
      timezoneOffset:  targetUser?.timezoneOffset  ?? '+00:00',
      enableIdleTimeout: targetUser?.enableIdleTimeout ?? true,
    });
  } catch (error: unknown) {
    console.error('Error fetching time entries:', error);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
});
