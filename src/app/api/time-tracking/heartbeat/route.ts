import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { heartbeatSession } from '@/lib/services/activeSessionService';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Updates lastUpdated on the active_sessions document.
// Only called by the client when displayState === 'working'.
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    await heartbeatSession(token.uid);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error processing heartbeat:', error);
    return NextResponse.json({ error: 'Failed to process heartbeat' }, { status: 500 });
  }
});
