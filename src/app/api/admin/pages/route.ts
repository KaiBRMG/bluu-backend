import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getAllPagePermissions } from '@/lib/services/pageService';
import { getAllGroups } from '@/lib/services/groupService';
import { PAGES, TEAMSPACES } from '@/lib/definitions';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/admin/pages
 * Admin-only. Returns all pages (from code), page-permissions (from Firestore),
 * all groups, and all users. Used by the Admin Sharing page.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('sharing')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
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
    return NextResponse.json({ error: 'Failed to fetch admin data' }, { status: 500 });
  }
});
