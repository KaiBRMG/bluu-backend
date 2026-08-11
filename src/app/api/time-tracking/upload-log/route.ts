import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import {
  getActiveSession,
  commitSession,
  getLedgerSessionMeta,
  updateSessionLog,
} from '@/lib/services/activeSessionService';
import { getUserById } from '@/lib/services/userService';
import { markAnalyticsDirty } from '@/lib/services/analyticsService';
import { parseBuffer } from '@/lib/parseBuffer';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LocalSessionBuffer } from '@/types/firestore';

// Called on startup when a local buffer exists for a session that is either:
//   A) stale (active_sessions exists but lastUpdated >= 15 min) — session not resumed
//   B) missing from active_sessions, because it was already closed for us — by the
//      stale-session Cloud Function, or by /discard when the user moved to another
//      device and clocked in there
//
// In case B a placeholder time_entries doc is waiting, so we merge the log into it.
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
    const [ledger, session, userData] = await Promise.all([
      getLedgerSessionMeta(buffer.sessionId),
      getActiveSession(token.uid),
      getUserById(token.uid),
    ]);

    // The session id is client-supplied and the merge below rewrites a ledger
    // doc's event log and totals wholesale, so the doc must belong to the
    // caller. One owned by anybody else is not theirs to touch at all.
    if (ledger && ledger.userId !== token.uid) {
      return NextResponse.json({ error: 'Session does not belong to caller' }, { status: 403 });
    }

    // A completed doc already holds its full event log (written at clock-out).
    // Re-merging one would let a replayed upload rewrite settled hours, so treat
    // it as done — the caller clears its buffer on any non-'discarded' action.
    if (ledger?.status === 'completed') {
      return NextResponse.json({ success: true, action: 'already-committed' });
    }

    if (ledger) {
      // A placeholder ledger doc is already waiting for this log — written
      // either by the stale-session Cloud Function or by /discard when another
      // device closed a session it held no buffer for. Merge our log into it.
      // Correct endTime using the buffer's last known activity timestamp so the
      // timesheet segment accurately reflects when the session actually ended,
      // rather than the CF-assigned lastUpdated which could be late in the day.
      await updateSessionLog(buffer.sessionId, buffer.events, parsedTotals, endTimeMs);
      // This day's rollup was written with hasIncompleteLog:true (the CF had no
      // event log to work from). Queue it for recompute — the rollup's 3-day
      // rolling window may have long since passed this session's date.
      await markAnalyticsDirty(
        token.uid, buffer.startTime, userData?.timezone || 'UTC', 'log-merged',
      );
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
        userData?.timezone || 'UTC',
        userData?.enableIdleTimeout ?? true,
      );
      // A ledger doc now exists for a day that may already have been rolled up
      // (the app can be reopened days later), so that day needs recomputing.
      await markAnalyticsDirty(
        token.uid, buffer.startTime, userData?.timezone || 'UTC', 'committed',
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
