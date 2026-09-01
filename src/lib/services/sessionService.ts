import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';

/**
 * Device-keyed sessions.
 *
 * ## What changed and why
 *
 * Access used to be one string: `users/{uid}.sessionToken`, rotated on every
 * login, compared by the client against its localStorage copy. One token means
 * exactly one live session per user, anywhere — which was correct while the only
 * client was the Electron shell, and is the single thing blocking web access.
 *
 * The unit is now the **device**: a client-minted UUID (`lib/deviceId.ts`) that
 * the server binds to a uid at login. `users/{uid}.sessions[deviceId]` holds
 * that device's own token, so displacement becomes a per-device fact rather than
 * a global one, and a staff member can hold a desktop session and a web session
 * at once without the two evicting each other.
 *
 * ## The policy, stated plainly
 *
 *  • **One desktop session.** A desktop login evicts every other desktop entry.
 *    That preserves the guarantee the old mechanism actually existed to give —
 *    the same person must not be clocked in on two machines.
 *  • **Web sessions are concurrent** with the desktop one and with each other.
 *    A web client cannot clock in, so nothing about time tracking is at risk.
 *
 * ## Backwards compatibility — the load-bearing part (rule 9c)
 *
 * A renderer open for weeks is still running the single-token bundle. So:
 *
 *  • `sessionToken` is STILL WRITTEN on every desktop login, exactly as before.
 *    An old client keeps comparing it and keeps behaving identically.
 *  • **A web login must never rotate `sessionToken`.** Rotating it would displace
 *    every old desktop client the moment anyone linked a browser — the one way
 *    this change could break users who never asked for it.
 *  • The client only trusts the new path when `sessions[deviceId]` actually
 *    exists, and falls back to the legacy comparison otherwise. A session
 *    established before this shipped therefore keeps working untouched.
 *
 * ## Revoking
 *
 * Revocation ROTATES an entry's token rather than deleting it. A deleted entry
 * sends the client back to the legacy `sessionToken` comparison, which may still
 * match — i.e. deleting would silently fail to sign anyone out. See
 * {@link revokeSession}.
 */

/**
 * Server-only reverse index: doc id = deviceId, body = {@link DeviceSessionIndexEntry}.
 *
 * `sessions` is a map on the user doc, and Firestore cannot query "which user
 * owns this map key". This index is what makes the lookup an O(1) doc get —
 * the same shape, and for the same reason, as `auth-emails`.
 */
export const DEVICE_SESSION_COLLECTION = 'device-sessions';

export type DeviceKind = 'desktop' | 'web';

export interface DeviceSessionIndexEntry {
  uid: string;
  kind: DeviceKind;
}

/** One entry in `users/{uid}.sessions`. */
export interface DeviceSession {
  /** Rotated on re-login and on revocation. The client compares against this. */
  token: string;
  kind: DeviceKind;
  /** Coarse "Chrome · Windows" style label, for a future session list. */
  label: string;
  createdTime: string;
  lastSeenTime: string;
}

function isDeviceKind(v: unknown): v is DeviceKind {
  return v === 'desktop' || v === 'web';
}

/**
 * Device ids are used as Firestore MAP KEYS and as document ids, so the shape is
 * validated rather than trusted. A key containing `.` would be read back as a
 * nested path and silently corrupt the map; `/` would break the index doc id.
 */
export function isValidDeviceId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

function cleanLabel(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 60) : '';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Reads the sessions map off a raw user document, discarding malformed entries. */
export function readSessions(data: any): Record<string, DeviceSession> {
  const raw = data?.sessions;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, DeviceSession> = {};
  for (const [id, v] of Object.entries(raw as Record<string, any>)) {
    if (!isValidDeviceId(id) || !v || typeof v !== 'object') continue;
    if (typeof v.token !== 'string' || !v.token) continue;
    out[id] = {
      token: v.token,
      kind: isDeviceKind(v.kind) ? v.kind : 'web',
      label: cleanLabel(v.label),
      createdTime: typeof v.createdTime === 'string' ? v.createdTime : '',
      lastSeenTime: typeof v.lastSeenTime === 'string' ? v.lastSeenTime : '',
    };
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface RegisterSessionInput {
  uid: string;
  deviceId: string;
  kind: DeviceKind;
  label?: string;
  /**
   * The already-rotated legacy token for a desktop login, so the two halves of
   * one login write the same value. Omitted for a web login, which must not
   * touch `sessionToken` at all (see the compatibility note above).
   */
  legacyToken?: string;
}

export interface RegisterSessionResult {
  /** The token this client stores locally and the snapshot compares against. */
  token: string;
  /** Device ids evicted by this login. Desktop-only, and informational. */
  evicted: string[];
}

/**
 * Binds a device to a user and returns that device's session token.
 *
 * Called once per successful login, after authorisation has already passed —
 * this function does not authorise anything, and must never be reachable from a
 * path that has not already established who the caller is.
 */
export async function registerSession(
  input: RegisterSessionInput,
): Promise<RegisterSessionResult> {
  const { uid, deviceId, kind } = input;
  if (!isValidDeviceId(deviceId)) {
    throw new Error('[sessionService] registerSession called with a malformed deviceId');
  }

  const userRef = adminDb.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    throw new Error(`[sessionService] registerSession called for unknown uid ${uid}`);
  }

  const existing = readSessions(snap.data());
  const now = new Date().toISOString();

  // A desktop login is exclusive: every OTHER desktop entry is evicted, so the
  // "one machine clocked in at a time" guarantee survives the move to per-device
  // sessions. Web entries are left alone.
  const evicted =
    kind === 'desktop'
      ? Object.entries(existing)
          .filter(([id, s]) => id !== deviceId && s.kind === 'desktop')
          .map(([id]) => id)
      : [];

  // Desktop sessions share the rotated legacy token, so an old bundle comparing
  // `sessionToken` and a new bundle comparing `sessions[deviceId].token` reach
  // the same verdict for the same device.
  const token = kind === 'desktop' && input.legacyToken ? input.legacyToken : randomUUID();

  const session: DeviceSession = {
    token,
    kind,
    label: cleanLabel(input.label),
    createdTime: existing[deviceId]?.createdTime || now,
    lastSeenTime: now,
  };

  const update: Record<string, unknown> = { [`sessions.${deviceId}`]: session };
  for (const id of evicted) update[`sessions.${id}`] = FieldValue.delete();

  const batch = adminDb.batch();
  batch.update(userRef, update);
  batch.set(adminDb.collection(DEVICE_SESSION_COLLECTION).doc(deviceId), {
    uid,
    kind,
    label: session.label,
    updatedAt: FieldValue.serverTimestamp(),
  });
  for (const id of evicted) {
    batch.delete(adminDb.collection(DEVICE_SESSION_COLLECTION).doc(id));
  }
  await batch.commit();

  invalidateUserCache(uid);
  return { token, evicted };
}

/**
 * Which registered, still-permitted user owns this device — or `null`.
 *
 * The whole point of the index: one doc get plus one cached user read, no query
 * and no collection scan. Returns `null` for an unknown id, and equally for a
 * device belonging to someone deactivated or archived, so a revoked employee's
 * old browser stops being recognised without anything having to sweep it.
 */
export async function lookupDeviceOwner(deviceId: string): Promise<string | null> {
  if (!isValidDeviceId(deviceId)) return null;

  const snap = await adminDb.collection(DEVICE_SESSION_COLLECTION).doc(deviceId).get();
  const uid = snap.data()?.uid;
  if (typeof uid !== 'string' || !uid) return null;

  const user = await getUserById(uid);
  if (!user || user.isActive === false || user.isArchived === true) return null;

  // The index can outlive the session it points at (an eviction races, a doc is
  // edited by hand). The user doc is the authority on whether the device is live.
  const sessions = readSessions(user);
  if (!sessions[deviceId]) return null;

  return uid;
}

/**
 * Ends one device's session.
 *
 * ROTATES the entry's token rather than deleting it, on purpose. Deleting the
 * entry would send that client back to the legacy `sessionToken` comparison,
 * which may still match — so the user would not actually be signed out. The
 * index doc is removed, which is what stops the device being *recognised* on a
 * public page; the rotated token is what signs it *out*.
 */
export async function revokeSession(uid: string, deviceId: string): Promise<boolean> {
  if (!isValidDeviceId(deviceId)) return false;

  const userRef = adminDb.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) return false;

  const sessions = readSessions(snap.data());
  const current = sessions[deviceId];
  if (!current) return false;

  const batch = adminDb.batch();
  batch.update(userRef, {
    [`sessions.${deviceId}`]: { ...current, token: randomUUID(), lastSeenTime: new Date().toISOString() },
  });
  batch.delete(adminDb.collection(DEVICE_SESSION_COLLECTION).doc(deviceId));
  await batch.commit();

  invalidateUserCache(uid);
  return true;
}

/**
 * Releases every device a user holds. Part of the delete cascade — without it
 * the index would keep resolving a deleted employee's browser to their old uid.
 */
export async function releaseAllDeviceSessions(uid: string): Promise<void> {
  const snap = await adminDb.collection(DEVICE_SESSION_COLLECTION).where('uid', '==', uid).get();
  if (snap.empty) return;
  const writer = adminDb.bulkWriter();
  for (const doc of snap.docs) writer.delete(doc.ref);
  await writer.close();
}
