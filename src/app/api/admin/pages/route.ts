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
 *
 * **Both Firestore collections are projected, never forwarded whole (rule 9i).**
 * `getAllGroups()` returns entire group docs — including `members`, an array of
 * every uid in the group — and the users query used to carry `photoURL`. Neither
 * is rendered anywhere on the Sharing page or in `UserDetailContent`, the only
 * two consumers, so both were billed on the wire on every load for nothing. The
 * page shows group *names* and sorts by `level`; it draws no avatars.
 *
 * If a revoke confirm ever needs a blast-radius count ("12 people will lose this
 * page"), add `memberCount: number` here rather than restoring the uid array —
 * the count is the thing the UI wants and it is a fraction of the bytes.
 *
 * **Cacheability (rule 9i): none.** `pagePermissions` is the live authorization
 * map an admin is actively editing, and `updatePermission` re-reads it straight
 * after every write; a cached read would show the change failing. `useAdminData`
 * does the caching instead, in-memory with a 5-minute TTL it controls.
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
      adminDb.collection('users').select('uid', 'displayName', 'workEmail', 'groups').get(),
    ]);

    const users = usersSnapshot.docs.map(doc => doc.data());

    return NextResponse.json({
      pages: PAGES,
      teamspaces: TEAMSPACES,
      pagePermissions,
      // Only the three fields the table renders: the label, the id it toggles
      // on, and the level it sorts by. Drops `members`, `description`,
      // `isDefault` and `createdAt`.
      groups: groups.map((g: { id: string; name: string; level: number }) => ({
        id: g.id,
        name: g.name,
        level: g.level,
      })),
      users,
    });
  } catch (error: unknown) {
    console.error('Error fetching admin pages:', error);
    return NextResponse.json({ error: 'Failed to fetch admin data' }, { status: 500 });
  }
});
