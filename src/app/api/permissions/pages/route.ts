import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getAllTeamspaces } from '@/lib/services/teamspaceService';
import { getAccessiblePages } from '@/lib/services/pageService';

/**
 * GET /api/permissions/pages
 * Returns all teamspaces and the current user's accessible pages with effective roles.
 * 3 Firestore reads total: user doc, teamspaces collection, pages collection.
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

    // Fetch user, teamspaces, and accessible pages in parallel
    const [user, teamspaces] = await Promise.all([
      getUserById(uid),
      getAllTeamspaces(),
    ]);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const accessiblePages = await getAccessiblePages(uid, user.groups || []);

    return NextResponse.json({ teamspaces, accessiblePages });
  } catch (error: unknown) {
    console.error('Error fetching permissions:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 });
  }
}
