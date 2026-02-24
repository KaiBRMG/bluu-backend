import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getActiveSession, commitSession } from '@/lib/services/activeSessionService';
import { getUserById } from '@/lib/services/userService';
import { parseBuffer } from '@/lib/parseBuffer';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LocalSessionBuffer } from '@/types/firestore';

// Explicit clock-out: parse the local buffer, write a time_entries ledger doc,
// and delete the active_sessions document — all in one atomic batch.
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { buffer } = await request.json() as { buffer: LocalSessionBuffer };

    if (!buffer?.sessionId || !Array.isArray(buffer.events)) {
      return NextResponse.json({ error: 'Invalid buffer payload' }, { status: 400 });
    }

    // Verify the active session belongs to this user
    const [session, userData] = await Promise.all([
      getActiveSession(token.uid),
      getUserById(token.uid),
    ]);

    if (!session) {
      return NextResponse.json({ error: 'No active session found' }, { status: 404 });
    }

    if (session.data.sessionId !== buffer.sessionId) {
      return NextResponse.json({ error: 'Session ID mismatch' }, { status: 400 });
    }

    const endTimeMs = Date.now();
    const parsedTotals = parseBuffer(buffer.events, endTimeMs);

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

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error stopping time tracking:', error);
    return NextResponse.json({ error: 'Failed to stop tracking' }, { status: 500 });
  }
});
