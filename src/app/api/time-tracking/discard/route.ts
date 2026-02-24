import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { deleteActiveSession } from '@/lib/services/activeSessionService';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Deletes the active_sessions document without creating a time_entries entry.
// Used only when there is no local buffer to upload (e.g. the session was started
// on a different device and the user explicitly discards it from this device).
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    await deleteActiveSession(token.uid);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error discarding session:', error);
    return NextResponse.json({ error: 'Failed to discard session' }, { status: 500 });
  }
});
