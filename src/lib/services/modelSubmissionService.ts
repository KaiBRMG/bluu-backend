import 'server-only';
import crypto from 'crypto';
import sharp from 'sharp';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  ALLOWED_IMAGE_FORMATS,
  MAX_FILES_PER_SESSION,
  MAX_UPLOAD_BYTES,
  SESSION_TTL_MS,
} from '@/lib/modelSubmissions';
import type {
  ModelSubmissionDocument,
  SubmissionPhoto,
  SubmissionPhotoUrls,
} from '@/types/modelSubmission';

export const SUBMISSIONS_COLLECTION = 'model-submissions';
export const SESSIONS_COLLECTION = 'model-submission-sessions';
export const RATE_COLLECTION = 'model-submission-rate';
const STORAGE_ROOT = 'model-submissions';

// ─── Abuse limits ────────────────────────────────────────────────────────────
// The public endpoints are unauthenticated, so every counter here is keyed off
// a salted hash of the caller IP and enforced inside a Firestore transaction.

const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Per-IP daily ceilings.
 *
 * Sized for the *shared-IP* case, not the single-applicant case. Three things
 * make one "IP" much busier than one person:
 *   - every page load opens a session, so a hesitant applicant burns several;
 *   - mobile carriers put thousands of users behind one CGNAT address;
 *   - in local development `clientIp` has no forwarding header to read, so it
 *     returns `unknown` and every request on the machine shares one bucket.
 * A tight limit here doesn't stop abuse any better — the session token, the
 * per-session caps, and the image validation do that — it just locks out real
 * applicants and anyone testing the form.
 */
export const RATE_LIMITS = {
  /** Sessions issued per IP per day — the ceiling on started applications. */
  sessions: 40,
  /** Completed submissions per IP per day. */
  submissions: 5,
  /** Images accepted per IP per day, across all sessions. */
  uploads: 250,
} as const;

export type RateAction = keyof typeof RATE_LIMITS;

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * HMAC key for session tokens. Prefer an explicit secret; otherwise derive one
 * deterministically from the service-account credential that already has to
 * exist for the app to boot, so this subsystem needs no new env var. Either way
 * the key never leaves the server.
 */
function signingKey(): Buffer {
  const explicit = process.env.MODEL_SUBMISSION_SECRET;
  if (explicit) return Buffer.from(explicit, 'utf8');
  return crypto
    .createHash('sha256')
    .update(process.env.FIREBASE_SERVICE_ACCOUNT ?? '')
    .update('model-submissions/v1')
    .digest();
}

function sign(sessionId: string): string {
  return crypto.createHmac('sha256', signingKey()).update(sessionId).digest('base64url');
}

/** Timing-safe signature check. Cheap gate before any Firestore read. */
export function verifySignature(sessionId: string, token: string): boolean {
  if (!/^[a-f0-9]{32}$/.test(sessionId) || typeof token !== 'string') return false;
  const expected = Buffer.from(sign(sessionId));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Salted, non-reversible client fingerprint. We never store a raw IP. */
export function hashIp(ip: string): string {
  return crypto.createHmac('sha256', signingKey()).update(`ip:${ip}`).digest('hex').slice(0, 32);
}

/** Best-effort client IP behind Vercel's proxy. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

/**
 * Consumes `cost` units of `action` for this IP within a rolling 24h window.
 * Returns false when the caller is over the limit; the window resets lazily on
 * the first request after it expires, so no cleanup job is needed.
 */
export async function consumeRate(
  ipHash: string,
  action: RateAction,
  cost = 1,
): Promise<boolean> {
  const ref = adminDb.collection(RATE_COLLECTION).doc(ipHash);
  const limit = RATE_LIMITS[action];

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const data = snap.exists ? snap.data() ?? {} : {};
    const windowStart: number = typeof data.windowStart === 'number' ? data.windowStart : 0;
    const fresh = now - windowStart > RATE_WINDOW_MS;

    const used: number = fresh ? 0 : typeof data[action] === 'number' ? data[action] : 0;
    if (used + cost > limit) return false;

    tx.set(
      ref,
      fresh
        ? { windowStart: now, sessions: 0, submissions: 0, uploads: 0, [action]: cost, expiresAt: Timestamp.fromMillis(now + RATE_WINDOW_MS * 2) }
        : { [action]: used + cost },
      { merge: true },
    );
    return true;
  });
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  ipHash: string;
  fileCount: number;
  consumed: boolean;
  createdAtMs: number;
}

/** Issues a fresh, unconsumed session. The id doubles as the submission id. */
export async function createSession(ipHash: string): Promise<{ sessionId: string; token: string }> {
  const sessionId = crypto.randomBytes(16).toString('hex');
  await adminDb.collection(SESSIONS_COLLECTION).doc(sessionId).set({
    ipHash,
    fileCount: 0,
    consumed: false,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
    // Firestore TTL policy on this field sweeps abandoned sessions.
    expiresAt: Timestamp.fromMillis(Date.now() + SESSION_TTL_MS),
  });
  return { sessionId, token: sign(sessionId) };
}

/** Loads a session only if the signature, existence, TTL, and state all hold. */
export async function loadSession(sessionId: string, token: string): Promise<SessionRecord | null> {
  if (!verifySignature(sessionId, token)) return null;
  const snap = await adminDb.collection(SESSIONS_COLLECTION).doc(sessionId).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  const createdAtMs = typeof d.createdAtMs === 'number' ? d.createdAtMs : 0;
  if (d.consumed === true) return null;
  if (Date.now() - createdAtMs > SESSION_TTL_MS) return null;
  return {
    id: sessionId,
    ipHash: typeof d.ipHash === 'string' ? d.ipHash : '',
    fileCount: typeof d.fileCount === 'number' ? d.fileCount : 0,
    consumed: false,
    createdAtMs,
  };
}

/**
 * Upload attempts allowed against one session, ever.
 *
 * `fileCount` is a *live* count — it goes back down when a photo is removed, so
 * replacing a photo is always possible. That alone would let someone cycle
 * upload/remove forever, so this monotonic ceiling sits behind it as the actual
 * abuse bound. Generous enough that a real applicant swapping photos and
 * retrying a flaky connection never notices it.
 */
export const MAX_UPLOAD_ATTEMPTS_PER_SESSION = 40;

export type SlotResult = 'ok' | 'full' | 'exhausted' | 'invalid';

/**
 * Reserves one live upload slot on the session. Transactional so parallel
 * uploads from the same page can't race past `MAX_FILES_PER_SESSION`.
 */
export async function reserveUploadSlot(sessionId: string): Promise<SlotResult> {
  const ref = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  return adminDb.runTransaction<SlotResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'invalid';
    const d = snap.data() ?? {};
    if (d.consumed === true) return 'invalid';

    const count = typeof d.fileCount === 'number' ? d.fileCount : 0;
    const attempts = typeof d.uploadAttempts === 'number' ? d.uploadAttempts : 0;
    if (count >= MAX_FILES_PER_SESSION) return 'full';
    if (attempts >= MAX_UPLOAD_ATTEMPTS_PER_SESSION) return 'exhausted';

    tx.update(ref, { fileCount: count + 1, uploadAttempts: attempts + 1 });
    return 'ok';
  });
}

/**
 * Gives a slot back and deletes the stored objects.
 *
 * Called when the applicant removes a photo, and also when an upload lands
 * after its tile was already removed — otherwise a replaced photo would hold
 * its capacity (and its bytes) for the life of the session, and the applicant
 * would eventually be told they had "reached the photo limit" while looking at
 * a half-empty grid.
 *
 * Idempotent: releasing an id twice is a no-op, so a retried request can't
 * decrement the count below what's actually stored.
 */
export async function releaseUpload(sessionId: string, photoId: string): Promise<boolean> {
  const ref = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const data = snap.data() ?? {};
  if (data.consumed === true) return false;

  const photos = (data.photos ?? {}) as Record<string, SubmissionPhoto | undefined>;
  const record = photos[photoId];
  if (!record) return false;

  const bucket = adminStorage.bucket();
  await Promise.all([
    bucket.file(record.path).delete({ ignoreNotFound: true }),
    bucket.file(record.thumbPath).delete({ ignoreNotFound: true }),
  ]).catch(() => {
    // A stuck object is not worth failing the applicant's interaction over —
    // the slot still needs releasing so they can upload a replacement.
  });

  await adminDb.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return;
    const d = fresh.data() ?? {};
    if (d.consumed === true) return;
    // Re-check inside the transaction: if a concurrent release already removed
    // it, decrementing again would under-count.
    if (!((d.photos ?? {}) as Record<string, unknown>)[photoId]) return;
    const count = typeof d.fileCount === 'number' ? d.fileCount : 1;
    tx.update(ref, {
      [`photos.${photoId}`]: FieldValue.delete(),
      fileCount: Math.max(0, count - 1),
    });
  });

  return true;
}

/** Marks a session spent. Returns false if it was already consumed (replay). */
export async function consumeSession(sessionId: string): Promise<boolean> {
  const ref = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    if ((snap.data() ?? {}).consumed === true) return false;
    tx.update(ref, { consumed: true, consumedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

// ─── Image ingest ────────────────────────────────────────────────────────────

const FULL_MAX_EDGE = 2400;
const THUMB_MAX_EDGE = 480;

export class ImageRejected extends Error {}

/**
 * Sniffs the ISO-BMFF box header for a HEIC/HEIF brand, so a decode failure can
 * be explained accurately rather than guessed at from the filename (which
 * arrives blank or wrong often enough to be useless).
 *
 * Layout: bytes 4-8 are `ftyp`, and 8-12 are the major brand — `heic`, `heix`,
 * `hevc`, `mif1`, `msf1` for the HEIF family.
 */
function isHeic(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = buffer.toString('ascii', 8, 12);
  return ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
}

/**
 * Decodes, re-encodes, and stores one uploaded image.
 *
 * Everything about the client's claim is ignored: `sharp` must be able to
 * decode the bytes and report a whitelisted format, which rules out renamed
 * archives, SVG payloads, and polyglot files. Re-encoding also drops all EXIF —
 * including GPS coordinates an applicant would not knowingly send us.
 *
 * Produces two objects: a full-size WebP for the detail view and a small WebP
 * thumbnail for the review grid.
 */
export async function ingestImage(
  sessionId: string,
  kind: 'selfie' | 'body' | 'earnings',
  buffer: Buffer,
): Promise<{ id: string; photo: SubmissionPhoto }> {
  if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
    throw new ImageRejected('That image is too large — keep it under 12MB.');
  }

  let pipeline: sharp.Sharp;
  let metadata: sharp.Metadata;
  try {
    pipeline = sharp(buffer, { limitInputPixels: 80_000_000, animated: false });
    metadata = await pipeline.metadata();
  } catch {
    // The browser transcodes HEIC before upload, so reaching here with one means
    // that failed (an old browser, or the wasm never loaded). Say so plainly —
    // "not a readable image" is baffling when you just picked a normal photo,
    // and the iOS setting below is something the applicant can actually act on.
    if (isHeic(buffer)) {
      throw new ImageRejected(
        'We could not read that iPhone photo. On your phone, open Settings → Camera → Formats and choose “Most Compatible”, then take or re-save the photo — or send a screenshot of it.',
      );
    }
    throw new ImageRejected("That file isn't a readable image.");
  }

  const format = metadata.format ?? '';
  if (!(ALLOWED_IMAGE_FORMATS as readonly string[]).includes(format)) {
    throw new ImageRejected('Please upload a JPEG, PNG, or WebP image.');
  }
  if (!metadata.width || !metadata.height || metadata.width < 200 || metadata.height < 200) {
    throw new ImageRejected('That image is too small to review — use the original photo.');
  }

  const id = crypto.randomBytes(8).toString('hex');
  const base = `${STORAGE_ROOT}/${sessionId}/${kind}-${id}`;

  // libvips can read a HEIC container's header — which is how we got the
  // dimensions above — and still fail here, because parsing the box structure
  // needs no codec but decoding the pixels needs HEVC. So the real decode is
  // guarded separately, and the same actionable message applies.
  let full: { data: Buffer; info: sharp.OutputInfo };
  let thumb: { data: Buffer; info: sharp.OutputInfo };
  try {
    [full, thumb] = await Promise.all([
      sharp(buffer, { limitInputPixels: 80_000_000, animated: false })
        .rotate()
        .resize({ width: FULL_MAX_EDGE, height: FULL_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer({ resolveWithObject: true }),
      sharp(buffer, { limitInputPixels: 80_000_000, animated: false })
        .rotate()
        .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 68 })
        .toBuffer({ resolveWithObject: true }),
    ]);
  } catch (error) {
    if (isHeic(buffer)) {
      throw new ImageRejected(
        'We could not read that iPhone photo. On your phone, open Settings → Camera → Formats and choose “Most Compatible”, then take or re-save the photo — or send a screenshot of it.',
      );
    }
    console.error('[model-submissions] image decode failed:', error);
    throw new ImageRejected('That image could not be processed. Try a different photo.');
  }

  const bucket = adminStorage.bucket();
  const photo: SubmissionPhoto = {
    path: `${base}.webp`,
    thumbPath: `${base}_thumb.webp`,
    width: full.info.width,
    height: full.info.height,
  };

  await Promise.all([
    bucket.file(photo.path).save(full.data, { contentType: 'image/webp' }),
    bucket.file(photo.thumbPath).save(thumb.data, { contentType: 'image/webp' }),
  ]);

  // Pending photos live on the session doc until the applicant submits, so the
  // submit route can resolve ids it issued itself rather than trusting paths
  // sent by the client.
  await adminDb
    .collection(SESSIONS_COLLECTION)
    .doc(sessionId)
    .set({ photos: { [id]: { kind, ...photo } } }, { merge: true });

  return { id, photo };
}

/** Resolves ids the upload route issued back to their stored photo records. */
export async function resolvePhotos(
  sessionId: string,
  ids: string[],
  kind: 'selfie' | 'body' | 'earnings',
): Promise<SubmissionPhoto[]> {
  if (ids.length === 0) return [];
  const snap = await adminDb.collection(SESSIONS_COLLECTION).doc(sessionId).get();
  const photos = (snap.data()?.photos ?? {}) as Record<
    string,
    (SubmissionPhoto & { kind: string }) | undefined
  >;
  const out: SubmissionPhoto[] = [];
  for (const id of ids) {
    const record = photos[id];
    if (!record || record.kind !== kind) continue;
    out.push({
      path: record.path,
      thumbPath: record.thumbPath,
      width: record.width,
      height: record.height,
    });
  }
  return out;
}

// ─── Signed URLs ─────────────────────────────────────────────────────────────

const SIGNED_URL_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Signed URLs are pinned to a 30-minute window rather than to "now".
 *
 * **This is what stops the review grid flickering.** A V4 signature covers both
 * the signing time (`X-Goog-Date`) and the expiry, so signing on demand
 * produces a *different URL string for the same file on every request* — the
 * browser sees a new resource each time, re-downloads every thumbnail, and the
 * grid visibly repaints on each load, each status change, and each navigation
 * back to the page.
 *
 * Anchoring both timestamps to the start of the current window makes the URL
 * byte-identical for every request inside it, so the HTTP cache hits and the
 * images are simply already there. The TTL is comfortably longer than the
 * window, so a URL minted in the last second of one window stays valid well
 * into the next.
 */
const URL_WINDOW_MS = 30 * 60 * 1000;

/**
 * Memoised signatures, keyed by path + window. Signing is local CPU (HMAC over
 * the canonical request), not a network call, but a reviewer's page load asks
 * for a few hundred of them — and re-signing would also be a chance to drift
 * off the window boundary.
 */
const urlMemo = new Map<string, string>();

function signingWindow(): { accessibleAt: Date; expires: Date; stamp: number } {
  const stamp = Math.floor(Date.now() / URL_WINDOW_MS) * URL_WINDOW_MS;
  return {
    accessibleAt: new Date(stamp),
    expires: new Date(stamp + SIGNED_URL_TTL_MS),
    stamp,
  };
}

async function signOne(path: string): Promise<string> {
  const { accessibleAt, expires, stamp } = signingWindow();
  const key = `${stamp}:${path}`;
  const memoised = urlMemo.get(key);
  if (memoised) return memoised;

  const [url] = await adminStorage.bucket().file(path).getSignedUrl({
    version: 'v4',
    action: 'read',
    accessibleAt,
    expires,
  });

  // Drop everything from older windows in one pass, so the map tracks the
  // working set rather than growing for the life of the instance.
  for (const existing of urlMemo.keys()) {
    if (!existing.startsWith(`${stamp}:`)) urlMemo.delete(existing);
  }
  urlMemo.set(key, url);
  return url;
}

/**
 * Photos are never public. Reviewers get time-limited signed URLs, minted only
 * after their page permission has been checked.
 */
export async function signPhotos(photos: SubmissionPhoto[]): Promise<SubmissionPhotoUrls[]> {
  return Promise.all(
    photos.map(async (p) => {
      const [url, thumbUrl] = await Promise.all([signOne(p.path), signOne(p.thumbPath)]);
      return { url, thumbUrl, width: p.width, height: p.height };
    }),
  );
}

/** Signs only thumbnails — the list view never needs full-size renders. */
export async function signThumbs(photos: SubmissionPhoto[]): Promise<SubmissionPhotoUrls[]> {
  return Promise.all(
    photos.map(async (p) => ({
      url: '',
      thumbUrl: await signOne(p.thumbPath),
      width: p.width,
      height: p.height,
    })),
  );
}

// ─── Firestore reads ─────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function toPhoto(v: any): SubmissionPhoto | null {
  if (!v || typeof v !== 'object' || typeof v.path !== 'string') return null;
  return {
    path: v.path,
    thumbPath: typeof v.thumbPath === 'string' ? v.thumbPath : v.path,
    width: typeof v.width === 'number' ? v.width : 0,
    height: typeof v.height === 'number' ? v.height : 0,
  };
}

function toPhotos(v: any): SubmissionPhoto[] {
  return Array.isArray(v) ? v.map(toPhoto).filter((p): p is SubmissionPhoto => p !== null) : [];
}

function mapDoc(doc: FirebaseFirestore.DocumentSnapshot): ModelSubmissionDocument {
  const d = doc.data() ?? {};
  return {
    id: doc.id,
    name: d.name ?? '',
    email: d.email ?? '',
    instagram: d.instagram ?? '',
    telegram: d.telegram ?? '',
    hasOnlyFans: d.hasOnlyFans === true,
    age: typeof d.age === 'number' ? d.age : 0,
    country: d.country ?? '',
    city: d.city ?? '',
    sexuality: d.sexuality ?? 'other',
    niche: d.niche ?? '',
    trialLink: d.trialLink ?? '',
    socialLinks: d.socialLinks ?? '',
    status: d.status === 'approved' || d.status === 'rejected' ? d.status : 'new',
    createdAt: d.createdAt?.toDate?.()?.toISOString() ?? new Date(0).toISOString(),
    earningsPhoto: toPhoto(d.earningsPhoto),
    selfies: toPhotos(d.selfies),
    bodyPhotos: toPhotos(d.bodyPhotos),
    reviewedBy: typeof d.reviewedBy === 'string' ? d.reviewedBy : null,
    reviewedAt: d.reviewedAt?.toDate?.()?.toISOString() ?? null,
    reviewNote: d.reviewNote ?? '',
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Newest first. `limit` bounds the read; the UI filters by status client-side. */
export async function listSubmissions(limit = 300): Promise<ModelSubmissionDocument[]> {
  const snap = await adminDb
    .collection(SUBMISSIONS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(mapDoc);
}

export async function getSubmission(id: string): Promise<ModelSubmissionDocument | null> {
  const snap = await adminDb.collection(SUBMISSIONS_COLLECTION).doc(id).get();
  return snap.exists ? mapDoc(snap) : null;
}
