import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getAccessiblePages, recomputeUserPermissions } from '@/lib/services/pageService';
import { TEAMSPACES, PAGES, getPageDef } from '@/lib/definitions';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/permissions/pages
 * Returns all teamspaces (from code) and the current user's accessible pages.
 *
 * Fast path (O(1)): user doc already has permittedPageIds — reconstruct ResolvedAccess
 * from the code-defined PAGES array, no extra Firestore reads.
 *
 * Fallback (O(N)): permittedPageIds absent (e.g. legacy user) — run the full
 * collection scan, then backfill permittedPageIds on the user doc for next time.
 *
 * Firestore reads (fast path): 1 (user doc)
 * Firestore reads (fallback):  1 (user doc) + 1 (page-permissions collection)
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const user = await getUserById(token.uid);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let accessiblePages;

    if (Array.isArray(user.permittedPageIds)) {
      // Fast path: reconstruct from denormalized list — zero extra Firestore reads
      accessiblePages = user.permittedPageIds
        .map((pageId: string) => getPageDef(pageId))
        .filter(Boolean)
        .map((page: NonNullable<ReturnType<typeof getPageDef>>) => ({
          pageId: page.pageId,
          title: page.title,
          teamspaceId: page.teamspaceId,
          href: page.href,
          icon: page.icon,
          order: page.order,
          // Grant details aren't needed by the client for rendering; omit for simplicity
          grantedVia: 'group' as const,
        }));
    } else {
      // Fallback: full resolution, then backfill so subsequent requests are fast
      accessiblePages = await getAccessiblePages(token.uid, user.groups || []);
      recomputeUserPermissions(token.uid, user.groups || []).catch(err =>
        console.error('[permissions/pages] Failed to backfill permittedPageIds:', err)
      );
    }

    return NextResponse.json({
      teamspaces: TEAMSPACES,
      accessiblePages,
      permissionsVersion: user.permissionsVersion ?? 0,
    });
  } catch (error: unknown) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 });
  }
});
