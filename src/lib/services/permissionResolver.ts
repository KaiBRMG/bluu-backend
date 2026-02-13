import type { PageDocument, PermissionRole, ResolvedAccess } from '@/types/firestore';
import { PERMISSION_ROLE_RANK } from '@/types/firestore';

/**
 * Resolves the effective permission for a single page given the user's UID and groups.
 * Uses the union/additive model: if ANY source grants access, the user gets it.
 * When multiple sources grant access, the highest role wins.
 */
export function resolvePagePermission(
  page: PageDocument,
  uid: string,
  userGroups: string[]
): { role: PermissionRole; via: 'user' | 'group'; groupId?: string } | null {
  let bestRole: PermissionRole | null = null;
  let bestVia: 'user' | 'group' = 'user';
  let bestGroupId: string | undefined;

  // Check direct user permission
  const userRole = page.permissions.users?.[uid];
  if (userRole) {
    bestRole = userRole;
    bestVia = 'user';
  }

  // Check group permissions
  for (const groupSlug of userGroups) {
    const groupRole = page.permissions.groups?.[groupSlug];
    if (groupRole) {
      if (!bestRole || PERMISSION_ROLE_RANK[groupRole] > PERMISSION_ROLE_RANK[bestRole]) {
        bestRole = groupRole;
        bestVia = 'group';
        bestGroupId = groupSlug;
      }
    }
  }

  if (!bestRole) return null;

  return { role: bestRole, via: bestVia, groupId: bestGroupId };
}

/**
 * Resolves access for all provided pages. Returns only the pages the user can access.
 */
export function resolveAccessiblePages(
  pages: PageDocument[],
  uid: string,
  userGroups: string[]
): ResolvedAccess[] {
  const results: ResolvedAccess[] = [];

  for (const page of pages) {
    const resolved = resolvePagePermission(page, uid, userGroups);
    if (resolved) {
      results.push({
        pageId: page.pageId,
        title: page.title,
        teamspaceId: page.teamspaceId,
        href: page.href,
        icon: page.icon,
        order: page.order,
        effectiveRole: resolved.role,
        grantedVia: resolved.via,
        grantingGroupId: resolved.groupId,
      });
    }
  }

  return results;
}
