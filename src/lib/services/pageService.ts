import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAccessiblePages } from './permissionResolver';
import type { PageDocument, PermissionRole, ResolvedAccess } from '@/types/firestore';

const DEFAULT_PAGES: Omit<PageDocument, 'createdAt' | 'updatedAt'>[] = [
  // CA Portal
  {
    pageId: 'shifts',
    title: 'Shifts',
    teamspaceId: 'ca-portal',
    href: '/ca-portal/shifts',
    icon: '/Icons/calendar-clock.svg',
    order: 0,
    ownerId: 'system',
    permissions: { users: {}, groups: { admin: 'full_access' } },
  },
  {
    pageId: 'documents',
    title: 'Documents',
    teamspaceId: 'ca-portal',
    href: '/ca-portal/documents',
    icon: null,
    order: 1,
    ownerId: 'system',
    permissions: { users: {}, groups: { admin: 'full_access' } },
  },
  {
    pageId: 'calendar',
    title: 'Calendar',
    teamspaceId: 'ca-portal',
    href: '/ca-portal/calendar',
    icon: null,
    order: 2,
    ownerId: 'system',
    permissions: { users: {}, groups: { admin: 'full_access' } },
  },
  // Admin
  {
    pageId: 'sharing',
    title: 'Sharing',
    teamspaceId: 'admin',
    href: '/admin/sharing',
    icon: null,
    order: 0,
    ownerId: 'system',
    permissions: { users: {}, groups: { admin: 'full_access' } },
  },
  {
    pageId: 'organisation-settings',
    title: 'Organisation Settings',
    teamspaceId: 'admin',
    href: '/admin/organisation-settings',
    icon: null,
    order: 1,
    ownerId: 'system',
    permissions: { users: {}, groups: { admin: 'full_access' } },
  },
  {
    pageId: 'user-settings',
    title: 'User Settings',
    teamspaceId: 'admin',
    href: '/admin/user-settings',
    icon: null,
    order: 2,
    ownerId: 'system',
    permissions: { users: {}, groups: { admin: 'full_access' } },
  },
  // Apps
  {
    pageId: 'time-tracking',
    title: 'Time Tracking',
    teamspaceId: 'apps',
    href: '/applications/time-tracking',
    icon: '/Icons/time-tracking.svg',
    order: 0,
    ownerId: 'system',
    permissions: { users: {}, groups: { admin: 'full_access' } },
  },
  {
    pageId: 'app-2',
    title: 'App 2 (Placeholder)',
    teamspaceId: 'apps',
    href: null,
    icon: null,
    order: 1,
    ownerId: 'system',
    permissions: { users: {}, groups: { admin: 'full_access' } },
  },
  {
    pageId: 'app-3',
    title: 'App 3 (Placeholder)',
    teamspaceId: 'apps',
    href: null,
    icon: null,
    order: 2,
    ownerId: 'system',
    permissions: { users: {}, groups: { admin: 'full_access' } },
  },
];

/**
 * Seeds default pages. Idempotent.
 */
export async function seedDefaultPages(): Promise<void> {
  const batch = adminDb.batch();
  let needsCommit = false;

  for (const page of DEFAULT_PAGES) {
    const ref = adminDb.collection('pages').doc(page.pageId);
    const doc = await ref.get();

    if (!doc.exists) {
      console.log(`[PageService] Creating page: ${page.title}`);
      batch.set(ref, {
        ...page,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      needsCommit = true;
    }
  }

  if (needsCommit) {
    await batch.commit();
  }
}

/**
 * Gets all pages (single collection read).
 */
export async function getAllPages(): Promise<PageDocument[]> {
  const snapshot = await adminDb.collection('pages').get();
  return snapshot.docs.map(doc => doc.data() as PageDocument);
}

/**
 * Gets a single page by ID.
 */
export async function getPageById(pageId: string): Promise<PageDocument | null> {
  const doc = await adminDb.collection('pages').doc(pageId).get();
  return doc.exists ? (doc.data() as PageDocument) : null;
}

/**
 * Returns all pages accessible to the given user, with effective roles.
 */
export async function getAccessiblePages(
  uid: string,
  userGroups: string[]
): Promise<ResolvedAccess[]> {
  const allPages = await getAllPages();
  return resolveAccessiblePages(allPages, uid, userGroups);
}

/**
 * Updates permissions on a page. Validates the permission structure.
 */
export async function updatePagePermissions(
  pageId: string,
  permissions: { users: Record<string, PermissionRole>; groups: Record<string, PermissionRole> }
): Promise<void> {
  const validRoles: PermissionRole[] = ['full_access', 'can_edit', 'can_view'];

  // Validate all role values
  for (const role of Object.values(permissions.users)) {
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid permission role: ${role}`);
    }
  }
  for (const role of Object.values(permissions.groups)) {
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid permission role: ${role}`);
    }
  }

  await adminDb.collection('pages').doc(pageId).update({
    permissions,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
