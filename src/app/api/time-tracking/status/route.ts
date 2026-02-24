import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getActiveSession } from '@/lib/services/activeSessionService';
import { getUserById } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    // Doc get by ID — O(1), no query needed
    const [session, userData] = await Promise.all([
      getActiveSession(token.uid),
      getUserById(token.uid),
    ]);

    const enableScreenshots = userData?.enableScreenshots ?? true;

    if (!session) {
      return NextResponse.json({ session: null, enableScreenshots });
    }

    return NextResponse.json({
      session: {
        sessionId:    session.data.sessionId,
        currentState: session.data.currentState,
        startTime:    session.data.startTime.toDate().toISOString(),
        lastUpdated:  session.data.lastUpdated.toDate().toISOString(),
        userClockOut: session.data.userClockOut,
      },
      enableScreenshots,
    });
  } catch (error: unknown) {
    console.error('Error getting time tracking status:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
});
