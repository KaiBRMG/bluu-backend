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
 *
 * **Cacheability (rule 9i): `private, max-age=60`, keyed on the caller.**
 * `AppLayout` mounts per page rather than in the layout, so `usePermissions`
 * re-fetches this on *every* navigation — one origin round trip per click, for
 * a payload that almost never changes. A short browser cache collapses that
 * burst without introducing any staleness the client does not already accept:
 * `permissionsCache.ts` already serves this same payload out of localStorage
 * for **4 hours**, and a real permission change does not arrive here at all —
 * it is pushed down the `users/{uid}` snapshot as `permittedPageIds`, which
 * `usePermissions` derives locally with zero reads. This response is only the
 * cold-start path and the `permissionsVersion` check.
 *
 * **`private` is load-bearing, and so is `Vary` (rule 10).** The body is one
 * user's page list, so no shared cache may hold it — which also means `s-maxage`
 * would be pointless here, since `private` is exactly the directive that stops
 * the CDN storing it. The browser's own cache keys on URL alone, so without
 * `Vary: Authorization` a second user signing in on the same machine could be
 * served the first user's sidebar for the rest of the window (`clearPermissionsCache()`
 * clears localStorage on sign-out, not the HTTP cache). A Firebase ID token is
 * stable for ~55 minutes, so varying on it costs about one extra 200 an hour.
 *
 * Only the 200 carries the header — a 404/500 must stay uncached or a transient
 * failure would pin an empty sidebar for a minute.
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

    return NextResponse.json(
      {
        teamspaces: TEAMSPACES,
        accessiblePages,
        permissionsVersion: user.permissionsVersion ?? 0,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=60',
          Vary: 'Authorization',
        },
      }
    );
  } catch (error: unknown) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 });
  }
});
