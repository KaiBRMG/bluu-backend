import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getAllPagePermissions } from '@/lib/services/pageService';
import { getAllGroups } from '@/lib/services/groupService';
import { PAGES, TEAMSPACES } from '@/lib/definitions';

/**
 * GET /api/admin/pages
 * Admin-only. Returns all pages (from code), page-permissions (from Firestore),
 * all groups, and all users. Used by the Admin Sharing page.
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

    // Verify caller is admin
    const caller = await getUserById(uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch Firestore data in parallel
    const [pagePermissions, groups, usersSnapshot] = await Promise.all([
      getAllPagePermissions(),
      getAllGroups(),
      adminDb.collection('users').select('uid', 'displayName', 'workEmail', 'groups', 'photoURL').get(),
    ]);

    const users = usersSnapshot.docs.map(doc => doc.data());

    return NextResponse.json({
      pages: PAGES,
      teamspaces: TEAMSPACES,
      pagePermissions,
      groups,
      users,
    });
  } catch (error: unknown) {
    console.error('Error fetching admin pages:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch admin data' }, { status: 500 });
  }
}
