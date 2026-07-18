import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getActiveSession, markUserClockOut } from '@/lib/services/activeSessionService';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Called when a client ends a session without an explicit clock-out: app close,
// pre-update install, or a displaced (multiple-session) logout.
// Marks the active_sessions doc with userClockOut:true so the session is not
// auto-resumed on next startup. Does NOT create a time_entries document —
// that happens when the client uploads its local buffer on next app open.
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId: unknown = body?.sessionId;

    const session = await getActiveSession(token.uid);
    if (!session || session.data.userClockOut) {
      return NextResponse.json({ success: true });
    }
    // active_sessions is keyed by uid, so a stale client (e.g. one displaced by a
    // login on another device) could otherwise clock out a session it no longer
    // owns. When the caller names a session, only close that one.
    if (typeof sessionId === 'string' && sessionId !== session.data.sessionId) {
      return NextResponse.json({ success: true });
    }
    await markUserClockOut(token.uid);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error during clock-out:', error);
    return NextResponse.json({ error: 'Failed to clock out' }, { status: 500 });
  }
});
