import { adminDb } from '../firebase-admin';
import { resolveAccessiblePages } from './permissionResolver';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { invalidateUserCache } from './userService';
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

  // Read the existing doc BEFORE overwriting so we can detect removed groups/users.
  // Without this, unsharing a group leaves that group's members with stale permittedPageIds.
  const prevDoc = await adminDb.collection('page-permissions').doc(pageId).get();
  const prevGroups: Record<string, true> = prevDoc.exists ? (prevDoc.data()?.groups ?? {}) : {};
  const prevUsers: Record<string, true> = prevDoc.exists ? (prevDoc.data()?.users ?? {}) : {};

  await adminDb.collection('page-permissions').doc(pageId).set({
    pageId,
    groups: permissions.groups || {},
    users: permissions.users || {},
  });

  // Union old + new: both added and removed groups/users need their permittedPageIds recomputed.
  const affectedGroupIds = [...new Set([
    ...Object.keys(prevGroups),
    ...Object.keys(permissions.groups || {}),
  ])];
  const affectedUserIds = [...new Set([
    ...Object.keys(prevUsers),
    ...Object.keys(permissions.users || {}),
  ])];

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
        permissionsVersion: FieldValue.increment(1),
      });
    }
    await directBatch.commit();
  }
}

/**
 * Grants and/or revokes **direct** page access for specific users, touching only
 * their own key in each page's `users` map.
 *
 * This is the narrow instrument for a subsystem that owns a page's audience
 * (GoLogin seats → `apps-gologin`), as opposed to `updatePagePermissions`, which
 * PUTs the whole map from the Sharing page. Field-level writes are the point:
 * a read-modify-write here would race an admin editing the same page and drop
 * whichever grant landed second (CLAUDE.md, Sharing known issue #4).
 *
 * **Group grants are never touched.** A user who reaches a page through a group
 * keeps it after a revoke — removing it would mean editing the group's access
 * for everyone in it. Callers that need to know check `resolvePagePermission`.
 *
 * Costs: 1 `getAll` over the named pages, ≤1 batch write, then (if anything
 * changed) 1 page-permissions read + 1 `getAll` of the users + 1 batch write.
 */
export async function setDirectPageGrants(
  uids: string[],
  change: { grant?: string[]; revoke?: string[] },
): Promise<void> {
  const grant = change.grant ?? [];
  const revoke = change.revoke ?? [];
  const pageIds = [...new Set([...grant, ...revoke])];
  for (const pageId of pageIds) {
    if (!getPageDef(pageId)) throw new Error(`Unknown page: ${pageId}`);
  }
  if (uids.length === 0 || pageIds.length === 0) return;

  const refs = pageIds.map((pageId) => adminDb.collection('page-permissions').doc(pageId));
  const snaps = await adminDb.getAll(...refs);
  const batch = adminDb.batch();
  let writes = 0;

  snaps.forEach((snap, i) => {
    const pageId = pageIds[i];
    const users: Record<string, true> = snap.exists ? (snap.data()?.users ?? {}) : {};
    if (grant.includes(pageId)) {
      const missing = uids.filter((uid) => !users[uid]);
      if (missing.length === 0) return;
      // `set` + merge creates the doc when the page has never been shared —
      // fail-closed until now, so granting these users widens it to exactly them.
      batch.set(
        refs[i],
        { pageId, users: Object.fromEntries(missing.map((uid) => [uid, true])) },
        { merge: true },
      );
      writes++;
    } else {
      // Revoke: never create a doc just to delete from it.
      const present = uids.filter((uid) => users[uid]);
      if (present.length === 0) return;
      const [head, ...tail] = present;
      batch.update(
        refs[i],
        new FieldPath('users', head),
        FieldValue.delete(),
        ...tail.flatMap((uid) => [new FieldPath('users', uid), FieldValue.delete()]),
      );
      writes++;
    }
  });

  if (writes === 0) return;
  await batch.commit();

  const userRefs = uids.map((uid) => adminDb.collection('users').doc(uid));
  const [allPermDocs, userSnaps] = await Promise.all([
    getAllPagePermissions(),
    adminDb.getAll(...userRefs),
  ]);
  const userBatch = adminDb.batch();
  let userWrites = 0;
  for (const userDoc of userSnaps) {
    // A deleted user has no doc to recompute — and `update` must not be what
    // recreates one.
    if (!userDoc.exists) continue;
    const accessible = resolveAccessiblePages(allPermDocs, userDoc.id, userDoc.data()?.groups ?? []);
    userBatch.update(userDoc.ref, {
      permittedPageIds: accessible.map((p) => p.pageId),
      permissionsVersion: FieldValue.increment(1),
    });
    userWrites++;
  }
  if (userWrites > 0) await userBatch.commit();
  // `checkPageAccess` reads `permittedPageIds` through the 60s user cache (rule 2).
  uids.forEach(invalidateUserCache);
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

  await adminDb.collection('users').doc(uid).update({
    permittedPageIds,
    permissionsVersion: FieldValue.increment(1),
  });
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
      permissionsVersion: FieldValue.increment(1),
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
