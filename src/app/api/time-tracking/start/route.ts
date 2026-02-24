import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { createActiveSession, getActiveSession } from '@/lib/services/activeSessionService';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { randomUUID } from 'crypto';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const existing = await getActiveSession(token.uid);

    if (existing && !existing.data.userClockOut) {
      // Active session already exists — return it so the client can decide to resume or discard
      return NextResponse.json({
        sessionId: existing.data.sessionId,
        alreadyActive: true,
        currentState: existing.data.currentState,
        startTime: existing.data.startTime.toDate().toISOString(),
        lastUpdated: existing.data.lastUpdated.toDate().toISOString(),
      });
    }

    const sessionId = randomUUID();
    const startTime = Date.now();
    await createActiveSession(token.uid, sessionId, startTime);

    return NextResponse.json({ sessionId, startTime });
  } catch (error: unknown) {
    console.error('Error starting time tracking:', error);
    return NextResponse.json({ error: 'Failed to start tracking' }, { status: 500 });
  }
});
