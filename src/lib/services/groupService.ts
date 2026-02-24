import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_GROUPS = [
  {
    id: 'unassigned',
    name: 'Unassigned',
    description: 'Default group for all new users',
    isDefault: true,
    level: -1,
  },
  {
    id: 'CA',
    name: 'Chat Agents',
    description: 'Chat support agents',
    isDefault: false,
    level: 0,
  },
  {
    id: 'SMM',
    name: 'Social Media Manager',
    description: 'Social media management team',
    isDefault: false,
    level: 0,
  },
  {
    id: 'OFAM',
    name: 'Account Manager',
    description: 'Account management team',
    isDefault: false,
    level: 1,
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Full administrative access',
    isDefault: false,
    level: 2,
  },
];

/**
 * Ensures all default groups exist. Idempotent — skips groups that already exist.
 * Uses a single getAll() instead of N sequential reads.
 */
export async function ensureDefaultGroups(): Promise<void> {
  const refs = DEFAULT_GROUPS.map(g => adminDb.collection('groups').doc(g.id));
  const snaps = await adminDb.getAll(...refs);

  const batch = adminDb.batch();
  let needsCommit = false;

  for (let i = 0; i < DEFAULT_GROUPS.length; i++) {
    if (!snaps[i].exists) {
      console.log(`[GroupService] Creating group: ${DEFAULT_GROUPS[i].name}`);
      batch.set(refs[i], {
        ...DEFAULT_GROUPS[i],
        members: [],
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
 * Gets all groups.
 */
export async function getAllGroups(): Promise<any[]> {
  const snapshot = await adminDb.collection('groups').get();
  return snapshot.docs.map(doc => doc.data());
}

/**
 * Gets group by ID.
 */
export async function getGroupById(groupId: string): Promise<any> {
  const doc = await adminDb.collection('groups').doc(groupId).get();
  return doc.exists ? doc.data() : null;
}
