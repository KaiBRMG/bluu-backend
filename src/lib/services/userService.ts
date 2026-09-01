import { adminDb } from '../firebase-admin';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { notifications } from '@/lib/notificationContent';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { normalizeEmail } from '@/lib/authEmail';
import { GROUP_DISPLAY_NAMES } from '@/types/firestore';

/** Server-only index: doc id = normalised email, body = { uid, email }. */
export const AUTH_EMAIL_COLLECTION = 'auth-emails';

export interface AuthEmailIndexEntry {
  uid: string;
  /** The address as registered/returned by Google — display form, not the key. */
  email: string;
}

export interface LoginRecord {
  uid: string;
  /** The address Google returned, in its canonical form. */
  email: string;
  /** Google's stable account id (`sub`) — survives the user renaming their Gmail. */
  googleSub?: string | null;
  /**
   * Which client is logging in. `'desktop'` is the default because that is what
   * every bundle predating device identity is, and those send no `kind` at all.
   *
   * It decides whether the legacy `sessionToken` rotates: a **web** login must
   * leave it alone, or every long-lived Electron renderer still comparing that
   * single token (rule 9c) would be displaced the moment anyone linked a
   * browser. See `sessionService.ts`.
   */
  kind?: 'desktop' | 'web';
}

/**
 * Records a successful login on an already-registered user.
 *
 * **This no longer creates user documents.** Since the personal-email migration,
 * a `users` doc is created only by an admin in the Employee Registry
 * (`POST /api/admin/users`); login is an allowlist check against docs that
 * already exist. A caller reaching this function has already resolved the uid
 * through {@link findUserUidByEmail}, so a missing doc here is a bug, not a new
 * signup — it throws rather than silently provisioning an account.
 *
 * Returns the rotated session token.
 */
export async function recordSuccessfulLogin(record: LoginRecord): Promise<string> {
  const userRef = adminDb.collection('users').doc(record.uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    throw new Error(`[UserService] recordSuccessfulLogin called for unknown uid ${record.uid}`);
  }

  const data = userDoc.data() ?? {};
  const isWebLogin = record.kind === 'web';
  // Rotated for a desktop login only. A web login leaves the legacy token
  // exactly as it found it, so a weeks-old renderer still comparing that single
  // value is not displaced by someone signing in on a browser.
  const sessionToken = isWebLogin ? (data.sessionToken ?? randomUUID()) : randomUUID();
  const isFirstLogin = !data.lastLoginAt;

  // An onboarding run that never reached "Submit details" is discarded, so the
  // user starts the flow from the terms step exactly as a first-time signup
  // would. Enforced here rather than client-side because this is the only
  // place that can be trusted, and it runs on every login.
  //
  // `photoURL` is included because it is the one field onboarding writes
  // before completion (the upload is immediate); everything else on the
  // details step is written in the same request that completes onboarding, so
  // an incomplete run leaves nothing else behind.
  const abandonedOnboarding = data.hasCompletedOnboarding !== true;
  if (abandonedOnboarding && !isFirstLogin) {
    console.log(`[UserService] Discarding incomplete onboarding: ${record.email}`);
  }

  // Self-heal the stored address to Google's spelling when the two differ only
  // cosmetically (an admin typed "J.Doe@gmail.com"; Google says "jdoe@gmail.com").
  // Guarded on the normalised forms matching, so this can never quietly move an
  // account onto a genuinely different address — that is migration's job alone.
  const emailNeedsSync =
    data.workEmail !== record.email &&
    normalizeEmail(data.workEmail) === normalizeEmail(record.email);

  await userRef.update({
    lastLoginAt: FieldValue.serverTimestamp(),
    ...(isWebLogin ? {} : { sessionToken }),
    ...(emailNeedsSync ? { workEmail: record.email } : {}),
    ...(record.googleSub && data.googleSub !== record.googleSub
      ? { googleSub: record.googleSub }
      : {}),
    ...(abandonedOnboarding ? { hasAcceptedTerms: false, photoURL: null } : {}),
  });

  invalidateUserCache(record.uid);

  if (isFirstLogin) {
    // Fires here rather than at registration: an admin may register someone days
    // before their start date, and a welcome sitting unread in an account they
    // cannot yet reach is not a welcome.
    void sendFirstLoginNotifications(record.uid, data);
  }

  return sessionToken;
}

/**
 * Welcome the user, and nudge admins only when there is actually something for
 * them to do. Registration normally assigns a group up front, so the "assign
 * them to a group" alert fires only for the deliberate `unassigned` case.
 * Non-blocking and batched — a notification failure must not fail a login.
 */
async function sendFirstLoginNotifications(
  uid: string,
  data: FirebaseFirestore.DocumentData,
): Promise<void> {
  try {
    const groups: string[] = data.groups ?? [];
    const assigned = groups.find((g) => g !== 'unassigned');
    const firstName: string = data.firstName || data.displayName || 'there';

    const notifBatch = adminDb.batch();
    addNotificationToBatch(
      notifBatch,
      uid,
      assigned
        ? notifications.welcomeToTeam(firstName, GROUP_DISPLAY_NAMES[assigned] ?? assigned)
        : notifications.welcomeToTeam(firstName),
    );

    if (!assigned) {
      const adminGroupSnap = await adminDb.collection('groups').doc('admin').get();
      const adminUids: string[] = adminGroupSnap.data()?.members ?? [];
      for (const adminUid of adminUids) {
        addNotificationToBatch(notifBatch, adminUid, notifications.adminNewUserAlert());
      }
    }

    await notifBatch.commit();
  } catch (err) {
    console.error('[UserService] Failed to create first-login notifications:', err);
  }
}

/**
 * Resolves an email address to the uid allowed to log in as it.
 *
 * **This is the authorisation gate for the whole desktop app.** Google says who
 * someone is; this says whether they may come in, and as whom. Returning null
 * means "not registered" and must be refused — never fall back to provisioning.
 *
 * Resolution order:
 *  1. `auth-emails/{normalisedEmail}` — an O(1) doc get, and the only uniqueness
 *     constraint that exists (the `users` collection has none on `workEmail`).
 *  2. A `workEmail` query fallback, which also **heals** the index. This exists
 *     for docs written before the index shipped, or by any path that forgets to
 *     claim one; it is a safety net, not the intended route.
 *
 * Note the fallback matches the *stored* string exactly, so it cannot resolve a
 * Gmail alias — only the index can. That is fine: the backfill populates the
 * index for every existing user.
 */
export async function findUserUidByEmail(email: string): Promise<string | null> {
  const key = normalizeEmail(email);
  if (!key) return null;

  const indexDoc = await adminDb.collection(AUTH_EMAIL_COLLECTION).doc(key).get();
  const indexedUid = indexDoc.data()?.uid;
  if (typeof indexedUid === 'string' && indexedUid) {
    return indexedUid;
  }

  const snap = await adminDb
    .collection('users')
    .where('workEmail', '==', email)
    .limit(1)
    .get();
  if (snap.empty) return null;

  const uid = snap.docs[0].id;
  await adminDb
    .collection(AUTH_EMAIL_COLLECTION)
    .doc(key)
    .set({ uid, email, updatedAt: FieldValue.serverTimestamp() })
    .catch((err) => console.error('[UserService] Failed to heal auth-email index:', err));
  return uid;
}

/**
 * Claims an email for a uid inside a transaction, failing if another user
 * already holds it.
 *
 * Email is the authorisation key, so a duplicate is an account-takeover risk
 * rather than a tidiness problem — and a plain check-then-write loses the race
 * between two concurrent registrations. The index doc *is* the lock.
 *
 * Pass `releaseKey` to atomically give up a previous address (the migration:
 * claim the personal one, release the company one, in one commit).
 *
 * Throws `EMAIL_TAKEN` if the address belongs to somebody else.
 */
export async function claimEmailInTransaction(
  tx: Transaction,
  params: { uid: string; email: string; releaseKey?: string },
): Promise<void> {
  const key = normalizeEmail(params.email);
  if (!key) throw new Error('INVALID_EMAIL');

  const ref = adminDb.collection(AUTH_EMAIL_COLLECTION).doc(key);
  const existing = await tx.get(ref);
  if (existing.exists && existing.data()?.uid !== params.uid) {
    throw new Error('EMAIL_TAKEN');
  }

  tx.set(ref, {
    uid: params.uid,
    email: params.email,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (params.releaseKey && params.releaseKey !== key) {
    tx.delete(adminDb.collection(AUTH_EMAIL_COLLECTION).doc(params.releaseKey));
  }
}

/** Drops an email claim. Used by the delete cascade. */
export async function releaseEmailClaim(email: string): Promise<void> {
  const key = normalizeEmail(email);
  if (!key) return;
  await adminDb.collection(AUTH_EMAIL_COLLECTION).doc(key).delete();
}

export interface NewUserRecord {
  uid: string;
  workEmail: string;
  /** Full legal first name. */
  firstName: string;
  lastName: string;
  /** Preferred nickname — what the app displays and seeds avatars from. */
  displayName: string;
  groupId: string;
}

/**
 * The `users` doc template for a newly registered (not yet logged-in) employee.
 *
 * This is the shape login used to create on the fly. It now belongs to
 * registration: an admin fills in the identity fields, and the user completes
 * the rest during onboarding. `lastLoginAt: null` is meaningful — it is what
 * the Employee Registry renders as **Invited**.
 *
 * Returns the write, but does NOT claim the email index or touch group
 * membership; the registration route does both in one transaction/batch.
 */
export function buildNewUserDoc(record: NewUserRecord): Record<string, unknown> {
  return {
    uid: record.uid,
    workEmail: record.workEmail,
    displayName: record.displayName,
    photoURL: null,
    firstName: record.firstName,
    lastName: record.lastName,
    groups: [record.groupId],
    createdAt: FieldValue.serverTimestamp(),
    // Null rather than absent, so "never logged in" is a value the registry can
    // filter on rather than the absence of one.
    lastLoginAt: null,
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
    // Rotated again on first login; a placeholder keeps the field's type stable.
    sessionToken: randomUUID(),
    hasAcceptedTerms: false,
    hasCompletedOnboarding: false,
    // TEMPORARY (see CLAUDE.md): new users are born with a correct signed-
    // identity TCC record, so they must never trigger the one-time stale-
    // permission reset. Existing users lack this field (falsy) and do.
    screenshotBugFixed: true,
  };
}

/**
 * Adds user UID to a group's members array
 */
export async function addUserToGroup(uid: string, groupId: string): Promise<void> {
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
