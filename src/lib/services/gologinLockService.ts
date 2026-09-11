/**
 * The GoLogin session lock — "someone else already has this profile open".
 *
 * ## Why it is ours and not GoLogin's
 *
 * GoLogin has no lock. Its docs say nothing about concurrent access, and the SDK
 * reads none of `isRunning` / `canBeRunning` / `isRunDisabled` / `lockEnabled`
 * before spawning a browser — it just launches. Two operators opening one
 * profile is therefore entirely possible, and the consequence is not a merge
 * conflict but the thing an anti-detect profile exists to avoid: one account,
 * two machines, two IPs, at the same moment.
 *
 * The provider's own `isRunning` flag cannot substitute either, because watching
 * it change would mean **polling GoLogin**, and a 429 there revokes the API token
 * permanently (CLAUDE.md rule 9e). So the lock is Firestore: authoritative across
 * machines, live over `onSnapshot`, and it costs the provider nothing.
 *
 * ## The lease secret
 *
 * A claim returns a 256-bit secret, and **that secret — not a Firebase ID token —
 * authenticates the heartbeat and the release.** The reason is lifetime: a
 * session can outlive an ID token (they expire hourly), and the Electron main
 * process holds no refresh token to mint a new one. A lease is the standard
 * shape for exactly this (etcd, Consul, S3 multipart) and it is strictly
 * narrower than an ID token: possession lets you keep or drop **one lock on one
 * profile** and nothing else. Only its SHA-256 is stored, so a database read
 * does not yield a usable lease.
 *
 * ## Why claims expire
 *
 * The lock is released by the same teardown that closes Orbita, which covers
 * Stop, a manually closed window, a crashed browser and app quit. It does **not**
 * cover a machine that loses power. So a holder heartbeats while it runs, and a
 * claim whose heartbeat has gone quiet for `STALE_AFTER_MS` may be taken. A lock
 * that cannot be released would be worse than no lock — one power cut and a
 * profile is unusable forever.
 */
import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';

/** Client-**readable** (a row must be able to say who holds it), server-written. */
export const GOLOGIN_SESSIONS_COLLECTION = 'gologin-sessions';

/** How often a holder re-stamps its claim. Matches the interval in `main.js`. */
export const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Three missed heartbeats. Long enough that a sleeping laptop or a slow network
 * does not hand someone's live session away; short enough that a hard crash
 * costs a colleague a couple of minutes rather than a support request.
 */
export const STALE_AFTER_MS = 3 * HEARTBEAT_INTERVAL_MS;

export interface GoLoginLockDoc {
  profileId: string;
  uid: string;
  /** Shown on the blocked row: "In use · Kai". Denormalised so the row costs no extra read. */
  displayName: string;
  /** Distinguishes the same person on two machines, which is still a conflict. */
  deviceId: string;
  /** SHA-256 of the lease secret. The secret itself is never stored. */
  secretHash: string;
  claimedAtMs: number;
  heartbeatAtMs: number;
}

export interface LockHolder {
  uid: string;
  displayName: string;
  heartbeatAtMs: number;
}

export interface ClaimResult {
  ok: boolean;
  /** Returned only to the winner. Authenticates its heartbeat and release. */
  secret?: string;
  /** Present when `ok` is false — who is holding it. */
  holder?: LockHolder;
}

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time, so a wrong lease cannot be discovered a byte at a time. */
function secretMatches(secret: string, storedHash: string): boolean {
  if (typeof storedHash !== 'string' || storedHash.length !== 64) return false;
  const a = Buffer.from(hash(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function isLive(lock: GoLoginLockDoc | undefined, now: number): boolean {
  return !!lock && now - (lock.heartbeatAtMs ?? 0) < STALE_AFTER_MS;
}

/**
 * Take the lock, or report who has it.
 *
 * A transaction rather than a get-then-set: two operators clicking Launch in the
 * same second is precisely the case this exists for, and a read-modify-write
 * would let both through.
 */
export async function claimProfileLock(params: {
  profileId: string;
  uid: string;
  displayName: string;
  deviceId: string;
}): Promise<ClaimResult> {
  const { profileId, uid, displayName, deviceId } = params;
  const ref = adminDb.collection(GOLOGIN_SESSIONS_COLLECTION).doc(profileId);
  const secret = randomBytes(32).toString('base64url');

  return adminDb.runTransaction<ClaimResult>(async (txn) => {
    const snap = await txn.get(ref);
    const current = snap.exists ? (snap.data() as GoLoginLockDoc) : undefined;
    const now = Date.now();

    if (isLive(current, now) && current!.deviceId !== deviceId) {
      // Includes the same person on a second machine. Same profile, two IPs —
      // the exact collision this prevents — so it is blocked, not waved through.
      return {
        ok: false,
        holder: {
          uid: current!.uid,
          displayName: current!.displayName,
          heartbeatAtMs: current!.heartbeatAtMs,
        },
      };
    }

    const claim: GoLoginLockDoc = {
      profileId,
      uid,
      displayName,
      deviceId,
      secretHash: hash(secret),
      // Re-claiming our own live lock keeps the original start time.
      claimedAtMs: current && current.deviceId === deviceId ? current.claimedAtMs : now,
      heartbeatAtMs: now,
    };
    txn.set(ref, claim);
    return { ok: true, secret };
  });
}

/**
 * Re-stamp a lock, proving possession of its lease.
 *
 * Returns false if the claim is gone or has been taken over — the caller's job
 * then is to stop the browser, not to re-take it. Silently re-claiming would
 * defeat the expiry: a machine that was declared dead would take the profile
 * back out from under whoever legitimately picked it up.
 */
export async function heartbeatProfileLock(params: {
  profileId: string;
  secret: string;
}): Promise<boolean> {
  const { profileId, secret } = params;
  const ref = adminDb.collection(GOLOGIN_SESSIONS_COLLECTION).doc(profileId);

  return adminDb.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return false;
    const current = snap.data() as GoLoginLockDoc;
    if (!secretMatches(secret, current.secretHash)) return false;
    txn.update(ref, { heartbeatAtMs: Date.now() });
    return true;
  });
}

/**
 * Give up a lock. Idempotent, and a no-op for a lease that no longer matches —
 * so a late teardown can never evict the operator who took over after us.
 */
export async function releaseProfileLock(params: {
  profileId: string;
  secret: string;
}): Promise<void> {
  const { profileId, secret } = params;
  const ref = adminDb.collection(GOLOGIN_SESSIONS_COLLECTION).doc(profileId);

  await adminDb.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return;
    const current = snap.data() as GoLoginLockDoc;
    if (!secretMatches(secret, current.secretHash)) return;
    txn.delete(ref);
  });
}

/**
 * Admin override: drop a lock without its lease.
 *
 * The escape hatch for the case auto-expiry cannot reach quickly enough — a
 * machine that died mid-session and a colleague who needs the profile now.
 * Authorisation is the caller's job; this function only does the delete.
 */
export async function forceReleaseProfileLock(profileId: string): Promise<void> {
  await adminDb.collection(GOLOGIN_SESSIONS_COLLECTION).doc(profileId).delete();
}
