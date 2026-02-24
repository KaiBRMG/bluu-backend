import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getLedgerEntriesByDateRange } from '@/lib/services/activeSessionService';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { TimeEntryLedgerDocument } from '@/types/firestore';

// ─── Segment normalisation ───────────────────────────────────────────
//
// The new time_entries documents store one session with a full event log.
// To avoid changing TimesheetView/DayTimeline, we decompose each session
// back into segment-style rows: { id, state, createdTime, lastTime }.

interface SegmentRow {
  id: string;
  state: 'working' | 'idle' | 'on-break' | 'paused';
  createdTime: string;
  lastTime: string;
}

function sessionToSegments(sessionId: string, data: TimeEntryLedgerDocument): SegmentRow[] {
  const segments: SegmentRow[] = [];
  const events = data.eventLog;

  if (!events || events.length === 0) {
    // Cloud Function created the doc before the log was uploaded — emit one working segment
    segments.push({
      id: sessionId,
      state: 'working',
      createdTime: data.startTime.toDate().toISOString(),
      lastTime: data.endTime.toDate().toISOString(),
    });
    return segments;
  }

  // Walk the event log and emit a segment for each non-working period,
  // then fill the gaps with working segments.
  let segStart = data.startTime.toMillis();
  let segIdx = 0;

  const emit = (
    state: SegmentRow['state'],
    startMs: number,
    endMs: number,
  ) => {
    if (endMs <= startMs) return;
    segments.push({
      id: `${sessionId}_${segIdx++}`,
      state,
      createdTime: new Date(startMs).toISOString(),
      lastTime: new Date(endMs).toISOString(),
    });
  };

  let idleStart: number | null = null;
  let breakStart: number | null = null;
  let pauseStart: number | null = null;

  for (const event of events) {
    const t = event.timestamp;

    switch (event.type) {
      case 'idle-start':
        emit('working', segStart, t);
        segStart = t;
        idleStart = t;
        break;
      case 'idle-end':
        if (idleStart !== null) emit('idle', idleStart, t);
        idleStart = null;
        segStart = t;
        break;
      case 'break-start':
        emit('working', segStart, t);
        segStart = t;
        breakStart = t;
        break;
      case 'break-end':
        if (breakStart !== null) emit('on-break', breakStart, t);
        breakStart = null;
        segStart = t;
        break;
      case 'pause':
        emit('working', segStart, t);
        segStart = t;
        pauseStart = t;
        break;
      case 'resume':
        if (pauseStart !== null) emit('paused', pauseStart, t);
        pauseStart = null;
        segStart = t;
        break;
      case 'clock-out':
        // Close the last open segment
        if (idleStart !== null) { emit('idle', idleStart, t); idleStart = null; }
        else if (breakStart !== null) { emit('on-break', breakStart, t); breakStart = null; }
        else if (pauseStart !== null) { emit('paused', pauseStart, t); pauseStart = null; }
        else emit('working', segStart, t);
        segStart = t;
        break;
      default:
        break;
    }
  }

  // If the log has no clock-out (interrupted session), close against endTime
  const endMs = data.endTime.toMillis();
  if (idleStart !== null) emit('idle', idleStart, endMs);
  else if (breakStart !== null) emit('on-break', breakStart, endMs);
  else if (pauseStart !== null) emit('paused', pauseStart, endMs);
  else if (segStart < endMs) emit('working', segStart, endMs);

  return segments;
}

// ─── Route handler ───────────────────────────────────────────────────

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const startDateStr = searchParams.get('startDate');
    const endDateStr   = searchParams.get('endDate');

    if (!startDateStr || !endDateStr) {
      return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });
    }

    const userId = targetUserId || token.uid;

    if (userId !== token.uid) {
      const caller = await getUserById(token.uid);
      if (!caller?.groups?.includes('admin')) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }

    const startDate = new Date(startDateStr);
    const endDate   = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 31 || diffDays < 0) {
      return NextResponse.json({ error: 'Date range must be 0-31 days' }, { status: 400 });
    }

    const endOfDay = new Date(endDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const [newEntries, targetUser] = await Promise.all([
      getLedgerEntriesByDateRange(userId, startDate, endOfDay),
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

    return NextResponse.json({
      entries: allRows,
      timezone:        targetUser?.timezone        ?? 'UTC',
      timezoneOffset:  targetUser?.timezoneOffset  ?? '+00:00',
      includeIdleTime: targetUser?.includeIdleTime ?? false,
    });
  } catch (error: unknown) {
    console.error('Error fetching time entries:', error);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
});
