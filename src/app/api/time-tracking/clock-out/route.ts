import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getActiveEntry, markUserClockOut } from '@/lib/services/timeEntryService';

export async function POST(request: NextRequest) {
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
      return NextResponse.json({ success: true });
    }

    // Only mark as clocked out if not already marked
    if (!active.data.userClockOut) {
      await markUserClockOut(active.id, uid);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error clocking out:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to clock out' }, { status: 500 });
  }
}
