import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Ensures the default "General" group exists.
 * Called on every login to guarantee the group exists before user assignment.
 */
export async function ensureDefaultGroups(): Promise<void> {
  const generalGroupRef = adminDb.collection('groups').doc('general');
  const generalGroup = await generalGroupRef.get();

  if (!generalGroup.exists) {
    console.log('[GroupService] Creating default General group');

    await generalGroupRef.set({
      id: 'general',
      name: 'General',
      description: 'Default group for all unassigned users',
      members: [],
      createdAt: FieldValue.serverTimestamp(),
      isDefault: true,
    });
  }
}

/**
 * Gets all groups (for admin UI, future enhancement)
 */
export async function getAllGroups(): Promise<any[]> {
  const groupsSnapshot = await adminDb.collection('groups').get();
  return groupsSnapshot.docs.map(doc => doc.data());
}

/**
 * Gets group by ID
 */
export async function getGroupById(groupId: string): Promise<any> {
  const groupDoc = await adminDb.collection('groups').doc(groupId).get();
  return groupDoc.exists ? groupDoc.data() : null;
}
