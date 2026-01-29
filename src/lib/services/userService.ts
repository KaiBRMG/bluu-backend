import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export interface CreateUserData {
  uid: string;
  workEmail: string;
  displayName: string;
  photoURL?: string;
}

/**
 * Ensures user document exists in Firestore.
 * Creates new document on first login, updates lastLoginAt on subsequent logins.
 */
export async function ensureUserExists(userData: CreateUserData): Promise<void> {
  const userRef = adminDb.collection('users').doc(userData.uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    console.log(`[UserService] Creating new user: ${userData.workEmail}`);

    // Extract first and last name from display name
    const [firstName, ...lastNameParts] = userData.displayName.split(' ');
    const lastName = lastNameParts.join(' ');

    // Create user document
    await userRef.set({
      uid: userData.uid,
      workEmail: userData.workEmail,
      displayName: userData.displayName,
      photoURL: userData.photoURL || null,
      firstName: firstName || '',
      lastName: lastName || '',
      groups: ['general'], // Assign to default General group
      createdAt: FieldValue.serverTimestamp(),
      lastLoginAt: FieldValue.serverTimestamp(),
      isActive: true,

      address: {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
      },

      gender: '',
      DOB: null,

      jobTitle: '',
      employmentType: '',

      contactInfo: {
        phoneNumber: '',
        countryCode: '',
        personalEmail: '',
        telegramHandle: '',
        emergencyContactName: '',
        emergencyContactNumber: '',
        emergencyContactEmail: '',
      },

      paymentMethod: '',
      paymentInfo: '',

      userComments: '',
      
    });

    // Add user to General group's member list (non-blocking for better performance)
    // The user document already has 'general' in its groups array, so this is just
    // syncing the reverse relationship. We don't need to block login for this.
    addUserToGroup(userData.uid, 'general').catch((err) => {
      console.error('[UserService] Failed to add user to group:', err);
    });
  } else {
    console.log(`[UserService] Updating last login: ${userData.workEmail}`);

    // Update last login timestamp for existing user
    await userRef.update({
      lastLoginAt: FieldValue.serverTimestamp(),
    });
  }
}

/**
 * Adds user UID to a group's members array
 */
async function addUserToGroup(uid: string, groupId: string): Promise<void> {
  const groupRef = adminDb.collection('groups').doc(groupId);
  await groupRef.update({
    members: FieldValue.arrayUnion(uid),
  });
}

/**
 * Gets user document by UID
 */
export async function getUserById(uid: string): Promise<any> {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  return userDoc.exists ? userDoc.data() : null;
}

/**
 * Gets all user groups
 */
export async function getUserGroups(uid: string): Promise<string[]> {
  const user = await getUserById(uid);
  return user?.groups || [];
}
