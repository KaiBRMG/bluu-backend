import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getAllPages } from '@/lib/services/pageService';
import { getAllTeamspaces } from '@/lib/services/teamspaceService';
import { getAllGroups } from '@/lib/services/groupService';

/**
 * GET /api/admin/pages
 * Admin-only. Returns all pages (with full permissions), all groups, and all users.
 * Used by the Admin Sharing page.
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

    // Fetch all data in parallel
    const [pages, teamspaces, groups, usersSnapshot] = await Promise.all([
      getAllPages(),
      getAllTeamspaces(),
      getAllGroups(),
      adminDb.collection('users').select('uid', 'displayName', 'workEmail', 'groups', 'photoURL').get(),
    ]);

    const users = usersSnapshot.docs.map(doc => doc.data());

    return NextResponse.json({ pages, teamspaces, groups, users });
  } catch (error: unknown) {
    console.error('Error fetching admin pages:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch admin data' }, { status: 500 });
  }
}
