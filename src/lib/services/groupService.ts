import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_GROUPS = [
  {
    id: 'general',
    name: 'General',
    description: 'Default group for all new users',
    isDefault: true,
    level: -1,
  },
  {
    id: 'chat-agents',
    name: 'Chat Agents',
    description: 'Chat support agents',
    isDefault: false,
    level: 0,
  },
  {
    id: 'social-media-manager',
    name: 'Social Media Manager',
    description: 'Social media management team',
    isDefault: false,
    level: 0,
  },
  {
    id: 'account-manager',
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
 */
export async function ensureDefaultGroups(): Promise<void> {
  const batch = adminDb.batch();
  let needsCommit = false;

  for (const group of DEFAULT_GROUPS) {
    const ref = adminDb.collection('groups').doc(group.id);
    const doc = await ref.get();

    if (!doc.exists) {
      console.log(`[GroupService] Creating group: ${group.name}`);
      batch.set(ref, {
        ...group,
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
