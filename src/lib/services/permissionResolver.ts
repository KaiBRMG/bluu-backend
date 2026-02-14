import type { PagePermissionDoc, ResolvedAccess } from '@/types/firestore';
import { PAGES } from '@/lib/definitions';

/**
 * Resolves whether a user has access to a page based on the permission doc.
 * Binary: either the user has access (via direct UID or group membership) or not.
 */
export function resolvePagePermission(
  permDoc: PagePermissionDoc | undefined,
  uid: string,
  userGroups: string[]
): { via: 'user' | 'group'; groupId?: string } | null {
  if (!permDoc) return null;

  // Check direct user permission
  if (permDoc.users?.[uid]) {
    return { via: 'user' };
  }

  // Check group permissions
  for (const groupSlug of userGroups) {
    if (permDoc.groups?.[groupSlug]) {
      return { via: 'group', groupId: groupSlug };
    }
  }

  return null;
}

/**
 * Resolves access for all pages. Returns only the pages the user can access.
 */
export function resolveAccessiblePages(
  permDocs: PagePermissionDoc[],
  uid: string,
  userGroups: string[]
): ResolvedAccess[] {
  const permMap = new Map<string, PagePermissionDoc>();
  for (const doc of permDocs) {
    permMap.set(doc.pageId, doc);
  }

  const results: ResolvedAccess[] = [];

  for (const page of PAGES) {
    const permDoc = permMap.get(page.pageId);
    const resolved = resolvePagePermission(permDoc, uid, userGroups);
    if (resolved) {
      results.push({
        pageId: page.pageId,
        title: page.title,
        teamspaceId: page.teamspaceId,
        href: page.href,
        icon: page.icon,
        order: page.order,
        grantedVia: resolved.via,
        grantingGroupId: resolved.groupId,
      });
    }
  }

  return results;
}
