import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import {
  getActiveSession,
  commitSession,
  ledgerDocExists,
  updateSessionLog,
} from '@/lib/services/activeSessionService';
import { getUserById } from '@/lib/services/userService';
import { parseBuffer } from '@/lib/parseBuffer';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LocalSessionBuffer } from '@/types/firestore';

// Called on startup when a local buffer exists for a session that is either:
//   A) stale (active_sessions exists but lastUpdated >= 15 min) — session not resumed
//   B) missing from active_sessions (Cloud Function already cleaned it up)
//
// In case B, if the Cloud Function created a time_entries doc, we merge the log in.
// In case A (session still open, user is just late), we commit it as a completed session.
// In case neither doc exists, the buffer is orphaned and we discard it.
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { buffer } = await request.json() as { buffer: LocalSessionBuffer };

    if (!buffer?.sessionId || !Array.isArray(buffer.events)) {
      return NextResponse.json({ error: 'Invalid buffer payload' }, { status: 400 });
    }

    // Determine the effective session end time from the buffer.
    // Priority: clock-out timestamp > last event timestamp > startTime.
    // The last event is either a clock-out (explicit), an activity heartbeat
    // (appended every 15 min while working — gives a tight crash bound), or a
    // state-transition event. Using this avoids inflating workingSeconds to
    // "now" (upload time) for sessions that ended hours ago.
    const clockOutEvent = buffer.events.find(e => e.type === 'clock-out');
    const lastEvent = buffer.events.length > 0 ? buffer.events[buffer.events.length - 1] : null;
    const endTimeMs = clockOutEvent
      ? clockOutEvent.timestamp
      : (lastEvent ? lastEvent.timestamp : buffer.startTime);
    const parsedTotals = parseBuffer(buffer.events, endTimeMs);

    // Check both possible states in parallel
    const [ledgerExists, session, userData] = await Promise.all([
      ledgerDocExists(buffer.sessionId),
      getActiveSession(token.uid),
      getUserById(token.uid),
    ]);

    if (ledgerExists) {
      // Cloud Function already created the time_entries doc — merge our log in.
      // Correct endTime using the buffer's last known activity timestamp so the
      // timesheet segment accurately reflects when the session actually ended,
      // rather than the CF-assigned lastUpdated which could be late in the day.
      await updateSessionLog(buffer.sessionId, buffer.events, parsedTotals, endTimeMs);
      return NextResponse.json({ success: true, action: 'log-merged' });
    }

    if (session && session.data.sessionId === buffer.sessionId) {
      // Session is still open (user opened app but chose not to resume, or slow CF)
      // Commit it now as completed
      await commitSession(
        token.uid,
        buffer.sessionId,
        buffer.startTime,
        endTimeMs,
        parsedTotals,
        buffer.events,
        userData?.timezone ?? 'UTC',
        userData?.includeIdleTime ?? false,
      );
      return NextResponse.json({ success: true, action: 'committed' });
    }

    // Neither time_entries nor active_sessions has a record for this session —
    // it was either already cleaned up or never reached Firestore. Discard.
    return NextResponse.json({ success: true, action: 'discarded' });
  } catch (error: unknown) {
    console.error('Error uploading session log:', error);
    return NextResponse.json({ error: 'Failed to upload log' }, { status: 500 });
  }
});
