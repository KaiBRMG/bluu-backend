import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getActiveSession, markUserClockOut } from '@/lib/services/activeSessionService';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Called when the Electron app window closes without an explicit clock-out.
// Marks the active_sessions doc with userClockOut:true so the session is not
// auto-resumed on next startup. Does NOT create a time_entries document —
// that happens when the client uploads its local buffer on next app open.
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const session = await getActiveSession(token.uid);
    if (!session || session.data.userClockOut) {
      return NextResponse.json({ success: true });
    }
    await markUserClockOut(token.uid);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error during clock-out:', error);
    return NextResponse.json({ error: 'Failed to clock out' }, { status: 500 });
  }
});
