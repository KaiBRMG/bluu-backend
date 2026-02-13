import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_TEAMSPACES = [
  { id: 'ca-portal', name: 'CA Portal', icon: '/Icons/ca-portal.svg', order: 0 },
  { id: 'admin', name: 'Admin', icon: '/Icons/shield-user.svg', order: 1 },
  { id: 'apps', name: 'Apps', icon: '/Icons/layout-panel-left.svg', order: 2 },
];

/**
 * Seeds default teamspaces. Idempotent.
 */
export async function seedDefaultTeamspaces(): Promise<void> {
  const batch = adminDb.batch();
  let needsCommit = false;

  for (const ts of DEFAULT_TEAMSPACES) {
    const ref = adminDb.collection('teamspaces').doc(ts.id);
    const doc = await ref.get();

    if (!doc.exists) {
      console.log(`[TeamspaceService] Creating teamspace: ${ts.name}`);
      batch.set(ref, {
        ...ts,
        createdAt: FieldValue.serverTimestamp(),
      });
      needsCommit = true;
    }
  }

  if (needsCommit) {
    await batch.commit();
  }
}

/**
 * Gets all teamspaces ordered by `order` field.
 */
export async function getAllTeamspaces(): Promise<any[]> {
  const snapshot = await adminDb.collection('teamspaces').orderBy('order').get();
  return snapshot.docs.map(doc => doc.data());
}
