import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getActiveEntry } from '@/lib/services/timeEntryService';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const active = await getActiveEntry(uid);
    if (!active) {
      return NextResponse.json({ entry: null });
    }

    return NextResponse.json({
      entry: {
        id: active.id,
        state: active.data.state,
        createdTime: active.data.createdTime?.toDate?.()?.toISOString() ?? null,
        lastTime: active.data.lastTime?.toDate?.()?.toISOString() ?? null,
      },
    });
  } catch (error: unknown) {
    console.error('Error getting time tracking status:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}
