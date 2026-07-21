import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { notifications } from '@/lib/notificationContent';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';

export interface CreateUserData {
  uid: string;
  workEmail: string;
  displayName: string;
}

/**
 * Ensures user document exists in Firestore.
 * Creates new document on first login, updates lastLoginAt on subsequent logins.
 * New users always start with no profile photo (initials avatar).
 */
export async function ensureUserExists(userData: CreateUserData): Promise<string> {
  const userRef = adminDb.collection('users').doc(userData.uid);
  const userDoc = await userRef.get();

  const sessionToken = randomUUID();

  if (!userDoc.exists) {
    console.log(`[UserService] Creating new user: ${userData.workEmail}`);

    // Extract first and last name from display name
    const [firstName, ...lastNameParts] = userData.displayName.split(' ');
    const lastName = lastNameParts.join(' ');

    // Create user document — photoURL is null so initials avatar is used
    await userRef.set({
      uid: userData.uid,
      workEmail: userData.workEmail,
      displayName: firstName || '',
      photoURL: null,
      firstName: firstName || '',
      lastName: lastName || '',
      groups: ['unassigned'], // Assign to default group
      createdAt: FieldValue.serverTimestamp(),
      lastLoginAt: FieldValue.serverTimestamp(),
      isActive: true,
      isArchived: false,

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

      timezone: '',
      timezoneOffset: '',
      hasPaidLeave: false,
      remainingUnpaidLeave: 4,
      remainingPaidLeave: 10,
      enableIdleTimeout: true,
      enableScreenshots: true,
      sessionToken,
      hasAcceptedTerms: false,
      hasCompletedOnboarding: false,
      // TEMPORARY (see CLAUDE.md): new users are born with a correct signed-
      // identity TCC record, so they must never trigger the one-time stale-
      // permission reset. Existing users lack this field (falsy) and do.
      screenshotBugFixed: true,
    });

    // Add user to Unassigned group's member list (non-blocking for better performance)
    addUserToGroup(userData.uid, 'unassigned').catch((err) => {
      console.error('[UserService] Failed to add user to group:', err);
    });

    // Send welcome notifications (non-blocking) — batched for atomicity and fewer round-trips
    adminDb.collection('groups').doc('admin').get().then(async (adminGroupSnap) => {
      const adminUids: string[] = adminGroupSnap.data()?.members ?? [];
      const notifBatch = adminDb.batch();
      addNotificationToBatch(notifBatch, userData.uid, notifications.welcomeToTeam(firstName || userData.displayName));
      for (const adminUid of adminUids) {
        addNotificationToBatch(notifBatch, adminUid, notifications.adminNewUserAlert());
      }
      await notifBatch.commit();
    }).catch((err) => {
      console.error('[UserService] Failed to create welcome notifications:', err);
    });
  } else {
    console.log(`[UserService] Updating last login: ${userData.workEmail}`);

    // Rotate session token and update last login — kicks out any existing session
    await userRef.update({
      lastLoginAt: FieldValue.serverTimestamp(),
      sessionToken,
    });
  }

  invalidateUserCache(userData.uid);
  return sessionToken;
}

/**
 * Finds the uid of an existing `users` doc by work email.
 *
 * Identity is keyed on the Firebase Auth uid, but the login flow only dedupes
 * at the Auth layer (getUserByEmail). If an email's Auth account is ever deleted
 * while its `users` doc lingers, a fresh login would otherwise mint a NEW uid and
 * create a SECOND doc for the same email (the `users` collection has no uniqueness
 * constraint on workEmail). Callers use this to recreate the Auth account under the
 * SAME uid instead, so all existing data (groups, permissions, historical records)
 * reattaches and no duplicate is created.
 *
 * Returns the existing uid, or null if no doc has this workEmail.
 */
export async function findUserUidByEmail(workEmail: string): Promise<string | null> {
  const snap = await adminDb
    .collection('users')
    .where('workEmail', '==', workEmail)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
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

// Module-level cache: uid → { data, expiresAt }.
// TTL of 60 s is safe because user documents change infrequently (group edits,
// profile updates) and those write paths call invalidateUserCache() to bust it
// immediately. The cache is per-serverless-instance, so cold-starts always miss.
const USER_CACHE_TTL_MS = 60_000;
const userCache = new Map<string, { data: any; expiresAt: number }>();

/**
 * Gets user document by UID.
 * Results are cached in-process for 60 s to prevent redundant Firestore reads
 * when multiple API helpers call getUserById for the same UID within a single
 * request (e.g. admin auth check + data fetch in /api/time-tracking/entries).
 */
export async function getUserById(uid: string): Promise<any> {
  const cached = userCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const userDoc = await adminDb.collection('users').doc(uid).get();
  const data = userDoc.exists ? userDoc.data() : null;
  userCache.set(uid, { data, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return data;
}

/**
 * Invalidates the in-process user cache for a given UID.
 * Call this after any write to the user document so the next getUserById
 * call fetches fresh data from Firestore.
 */
export function invalidateUserCache(uid: string): void {
  userCache.delete(uid);
}

/**
 * Gets all user groups
 */
export async function getUserGroups(uid: string): Promise<string[]> {
  const user = await getUserById(uid);
  return user?.groups || [];
}

/**
 * Returns all user documents that have the 'time-tracking' page in their permittedPageIds.
 */
export async function getAllTimeTrackingUsers(): Promise<any[]> {
  const snap = await adminDb
    .collection('users')
    .where('permittedPageIds', 'array-contains', 'time-tracking')
    .get();
  return snap.docs.map(d => d.data());
}
