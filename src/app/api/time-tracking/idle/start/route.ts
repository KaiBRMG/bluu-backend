import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { updateEntryLastTime, createTimeEntry } from '@/lib/services/timeEntryService';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const { currentEntryId } = await request.json();
    if (!currentEntryId) {
      return NextResponse.json({ error: 'Missing currentEntryId' }, { status: 400 });
    }

    await updateEntryLastTime(currentEntryId, uid);
    const entryId = await createTimeEntry(uid, 'idle');
    return NextResponse.json({ entryId });
  } catch (error: unknown) {
    console.error('Error starting idle:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to start idle' }, { status: 500 });
  }
}
