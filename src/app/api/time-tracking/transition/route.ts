import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { updateSessionState } from '@/lib/services/activeSessionService';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ActiveSessionState } from '@/types/firestore';

type TransitionType =
  | 'idle'
  | 'resume'
  | 'break-start'
  | 'break-end'
  | 'pause'
  | 'resume-from-pause';

const TRANSITION_STATE_MAP: Record<TransitionType, ActiveSessionState> = {
  'idle':             'idle',
  'resume':           'working',
  'break-start':      'on-break',
  'break-end':        'working',
  'pause':            'paused',
  'resume-from-pause': 'working',
};

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { transition } = await request.json() as { transition: TransitionType };

    if (!transition || !(transition in TRANSITION_STATE_MAP)) {
      return NextResponse.json({ error: 'Invalid or missing transition' }, { status: 400 });
    }

    const newState = TRANSITION_STATE_MAP[transition];
    await updateSessionState(token.uid, newState);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error processing transition:', error);
    return NextResponse.json({ error: 'Failed to process transition' }, { status: 500 });
  }
});
