import { adminDb } from '../firebase-admin';
import { resolveAccessiblePages } from './permissionResolver';
import type { PagePermissionDoc, ResolvedAccess } from '@/types/firestore';
import { PAGES, getPageDef } from '@/lib/definitions';

/**
 * Gets all page-permission docs from Firestore (single collection read).
 */
export async function getAllPagePermissions(): Promise<PagePermissionDoc[]> {
  const snapshot = await adminDb.collection('page-permissions').get();
  return snapshot.docs.map(doc => doc.data() as PagePermissionDoc);
}

/**
 * Gets a single page-permission doc by page ID.
 */
export async function getPagePermission(pageId: string): Promise<PagePermissionDoc | null> {
  const doc = await adminDb.collection('page-permissions').doc(pageId).get();
  return doc.exists ? (doc.data() as PagePermissionDoc) : null;
}

/**
 * Returns all pages accessible to the given user, with grant info.
 */
export async function getAccessiblePages(
  uid: string,
  userGroups: string[]
): Promise<ResolvedAccess[]> {
  const allPermDocs = await getAllPagePermissions();
  return resolveAccessiblePages(allPermDocs, uid, userGroups);
}

/**
 * Updates permissions on a page. Creates the doc if it doesn't exist.
 * After writing, recomputes permittedPageIds for all affected users.
 * Permissions are binary: presence in the map = access.
 */
export async function updatePagePermissions(
  pageId: string,
  permissions: { groups: Record<string, true>; users: Record<string, true> }
): Promise<void> {
  if (!getPageDef(pageId)) {
    throw new Error(`Unknown page: ${pageId}`);
  }

  await adminDb.collection('page-permissions').doc(pageId).set({
    pageId,
    groups: permissions.groups || {},
    users: permissions.users || {},
  });

  // Recompute for all groups that now have (or had) access to this page.
  // Fetch all group members who belong to any group touching this page, then recompute.
  const affectedGroupIds = Object.keys(permissions.groups || {});
  const affectedUserIds = Object.keys(permissions.users || {});

  // Collect all unique uids from affected groups
  if (affectedGroupIds.length > 0) {
    await Promise.all(affectedGroupIds.map(gid => recomputePermissionsForGroup(gid)));
  }

  // Also recompute for directly-granted users — batch-read all docs in one round-trip
  if (affectedUserIds.length > 0) {
    const userRefs = affectedUserIds.map(uid => adminDb.collection('users').doc(uid));
    const [allPermDocs, userSnaps] = await Promise.all([
      getAllPagePermissions(),
      adminDb.getAll(...userRefs),
    ]);
    const directBatch = adminDb.batch();
    for (const userDoc of userSnaps) {
      if (!userDoc.exists) continue;
      const userGroups: string[] = userDoc.data()?.groups ?? [];
      const accessible = resolveAccessiblePages(allPermDocs, userDoc.id, userGroups);
      directBatch.update(adminDb.collection('users').doc(userDoc.id), {
        permittedPageIds: accessible.map(p => p.pageId),
      });
    }
    await directBatch.commit();
  }
}

/**
 * Recomputes and persists permittedPageIds on a single user document.
 * Call this whenever the user's groups change or a page's permissions change.
 * Costs: 1 collection read (page-permissions) + 1 user doc write.
 */
export async function recomputeUserPermissions(uid: string, userGroups: string[]): Promise<void> {
  const allPermDocs = await getAllPagePermissions();
  const accessible = resolveAccessiblePages(allPermDocs, uid, userGroups);
  const permittedPageIds = accessible.map(p => p.pageId);

  await adminDb.collection('users').doc(uid).update({ permittedPageIds });
}

/**
 * Recomputes and persists permittedPageIds for every member of a group
 * after that group's permissions on any page change.
 * Costs: 1 group doc read + 1 page-permissions collection read +
 *        1 getAll() for all member user docs (replaces N sequential reads) +
 *        1 batch write for all user docs.
 */
export async function recomputePermissionsForGroup(groupId: string): Promise<void> {
  const groupDoc = await adminDb.collection('groups').doc(groupId).get();
  if (!groupDoc.exists) return;

  const members: string[] = groupDoc.data()?.members ?? [];
  if (members.length === 0) return;

  // Fetch page permissions and all member user docs in parallel (2 round-trips total)
  const memberRefs = members.map(uid => adminDb.collection('users').doc(uid));
  const [allPermDocs, memberSnaps] = await Promise.all([
    getAllPagePermissions(),
    adminDb.getAll(...memberRefs),
  ]);

  const batch = adminDb.batch();
  for (const userDoc of memberSnaps) {
    if (!userDoc.exists) continue;
    const userGroups: string[] = userDoc.data()?.groups ?? [];
    const accessible = resolveAccessiblePages(allPermDocs, userDoc.id, userGroups);
    batch.update(adminDb.collection('users').doc(userDoc.id), {
      permittedPageIds: accessible.map(p => p.pageId),
    });
  }

  await batch.commit();
}

/**
 * Seeds initial page-permissions for admin group on all pages. Idempotent.
 * Uses a single getAll() instead of N sequential reads.
 */
export async function seedDefaultPagePermissions(): Promise<void> {
  const refs = PAGES.map(page => adminDb.collection('page-permissions').doc(page.pageId));
  const snaps = await adminDb.getAll(...refs);

  const batch = adminDb.batch();
  let needsCommit = false;

  for (let i = 0; i < PAGES.length; i++) {
    if (!snaps[i].exists) {
      console.log(`[PageService] Creating page-permission: ${PAGES[i].pageId}`);
      batch.set(refs[i], {
        pageId: PAGES[i].pageId,
        groups: { admin: true },
        users: {},
      });
      needsCommit = true;
    }
  }

  if (needsCommit) {
    await batch.commit();
  }
}
