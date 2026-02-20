import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { deleteScreenshots } from '@/lib/services/screenshotService';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Must be admin
    const caller = await getUserById(uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { screenshotIds } = await request.json();
    if (!Array.isArray(screenshotIds) || screenshotIds.length === 0) {
      return NextResponse.json({ error: 'screenshotIds must be a non-empty array' }, { status: 400 });
    }

    if (screenshotIds.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 screenshots per delete request' }, { status: 400 });
    }

    await deleteScreenshots(screenshotIds);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting screenshots:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to delete screenshots' }, { status: 500 });
  }
}
