import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getAccessiblePages } from '@/lib/services/pageService';
import { TEAMSPACES } from '@/lib/definitions';

/**
 * GET /api/permissions/pages
 * Returns all teamspaces (from code) and the current user's accessible pages.
 * Firestore reads: 1 (user doc) + 1 (page-permissions collection) = 2 reads total.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const user = await getUserById(uid);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const accessiblePages = await getAccessiblePages(uid, user.groups || []);

    return NextResponse.json({ teamspaces: TEAMSPACES, accessiblePages });
  } catch (error: unknown) {
    console.error('Error fetching permissions:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 });
  }
}
