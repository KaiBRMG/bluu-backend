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
}

/**
 * Seeds initial page-permissions for admin group on all pages. Idempotent.
 */
export async function seedDefaultPagePermissions(): Promise<void> {
  const batch = adminDb.batch();
  let needsCommit = false;

  for (const page of PAGES) {
    const ref = adminDb.collection('page-permissions').doc(page.pageId);
    const doc = await ref.get();

    if (!doc.exists) {
      console.log(`[PageService] Creating page-permission: ${page.pageId}`);
      batch.set(ref, {
        pageId: page.pageId,
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
