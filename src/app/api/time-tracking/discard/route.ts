import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { interruptActiveSession } from '@/lib/services/activeSessionService';
import { getUserById } from '@/lib/services/userService';
import { markAnalyticsDirty } from '@/lib/services/analyticsService';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Clears the caller's active_sessions doc so a new session can start, for the
// case where THIS device holds no local buffer for it — i.e. the session was
// tracked on another device (or a reinstall wiped IndexedDB).
//
// It does NOT delete the session. The event log lives only on the device that
// recorded it, and that device uploads it on its next start; deleting the doc
// here left that upload with nothing to attach to and silently destroyed a real
// shift. `interruptActiveSession` leaves a placeholder ledger doc instead, which
// /upload-log later merges the event log into. See time-tracking.md §3.
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const userData = await getUserById(token.uid);
    const timezone = userData?.timezone || 'UTC';

    const closed = await interruptActiveSession(
      token.uid,
      timezone,
      userData?.enableIdleTimeout ?? true,
    );

    // A ledger doc now exists for that day, so its rollup is stale. (The later
    // log merge marks it dirty again once the real totals arrive.)
    if (closed) {
      await markAnalyticsDirty(token.uid, closed.startTimeMs, timezone, 'interrupted');
    }

    return NextResponse.json({ success: true, sessionId: closed?.sessionId ?? null });
  } catch (error: unknown) {
    console.error('Error closing orphaned session:', error);
    return NextResponse.json({ error: 'Failed to discard session' }, { status: 500 });
  }
});
