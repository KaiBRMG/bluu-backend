import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';
import {
  DEFAULT_SNIP_SETTINGS,
  MAX_SNIP_BYTES,
  MAX_SNIP_RECORDING_MS,
  MAX_SNIP_VIDEO_BYTES,
  SHARE_ID_ALPHABET,
  SHARE_ID_LENGTH,
  SNIP_CONTENT_TYPE,
  SNIP_PUBLIC_PREFIX,
  SNIP_STORAGE_PREFIX,
  SNIP_VIDEO_CONTENT_TYPE,
  SNIPPING_TOOL_PAGE_ID,
  isValidSnipId,
  resolveSnipKind,
  resolveSnipSettings,
  snipExpiryMs,
  type SnipKind,
  type SnipRetention,
  type SnipSettings,
} from '@/lib/snips';
import type { PublicSnip, SnipPage, SnipRow } from '@/types/snips';

const COLLECTION = 'snips';

/** How long the renderer has to PUT the capture. Mirrors the OF media slot. */
const SIGNED_WRITE_TTL_MS = 15 * 60 * 1000;
/** How long a redirected image URL stays good for. Short — the public page
 *  redirects through `/api/public/snip/{id}/image` on every load, so the URL a
 *  recipient actually holds never expires; only the one-hop target does. */
const SIGNED_READ_TTL_MS = 60 * 60 * 1000;

/** A pending upload whose finalise call never arrived is garbage after this. */
const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000;

/**
 * The hard ceiling on one user's library, enforced when a slot is reserved. The
 * grid pages through it `SNIP_PAGE_SIZE` at a time, so this is a storage cap
 * rather than a rendering one.
 */
const MAX_SNIPS_PER_USER = 500;

// ─── Authorisation ───────────────────────────────────────────────────

/**
 * The single gate for every snip route.
 *
 * Tier 2 — page permission (`apps-snipping-tool`). Ownership is checked
 * separately, per row, everywhere a specific snip is addressed: holding the
 * page lets you capture and list **your own** snips, and says nothing about
 * anyone else's.
 */
export function requireSnippingToolAccess(uid: string): Promise<NextResponse | null> {
  return checkPageAccess(uid, SNIPPING_TOOL_PAGE_ID);
}

// ─── Share ids ───────────────────────────────────────────────────────

/**
 * ~160 bits of share token, which is also the document id.
 *
 * `randomBytes(...) % 32` is unbiased here and only because the alphabet is
 * exactly 32 characters — 256 divides evenly by it. Changing the alphabet's
 * length reintroduces modulo bias and this has to become a rejection loop.
 */
function mintSnipId(): string {
  const bytes = randomBytes(SHARE_ID_LENGTH);
  let out = '';
  for (let i = 0; i < SHARE_ID_LENGTH; i++) {
    out += SHARE_ID_ALPHABET[bytes[i] % SHARE_ID_ALPHABET.length];
  }
  return out;
}

export function snipShareUrl(id: string): string {
  return `${PUBLIC_APP_ORIGIN}${SNIP_PUBLIC_PREFIX}/${id}`;
}

/**
 * The still: the capture itself for an image snip, the poster frame for a
 * recording. Both are PNGs behind the same route, which is why one path serves
 * them — the route resolves `storagePath` vs `posterPath` from the row.
 */
function snipImageUrl(id: string): string {
  return `${PUBLIC_APP_ORIGIN}/api/public/snip/${id}/image`;
}

/**
 * The recording. A **separate** route from `/image`, not a query parameter on
 * it, for two unrelated reasons that point the same way: `/image` is the URL
 * already sitting in Slack unfurls and browser caches for every snip ever
 * shared, so its meaning must not shift underneath them; and a `<video src>`
 * issues range requests where an `<img src>` issues one GET, which is a
 * different traffic shape worth being able to see separately in the logs.
 */
function snipVideoUrl(id: string): string {
  return `${PUBLIC_APP_ORIGIN}/api/public/snip/${id}/video`;
}

/** The public URL for whichever of the two the row actually is. */
function snipMediaUrl(id: string, kind: SnipKind): string {
  return kind === 'video' ? snipVideoUrl(id) : snipImageUrl(id);
}

// ─── Settings ────────────────────────────────────────────────────────

export async function getSnipSettings(uid: string): Promise<SnipSettings> {
  const user = await getUserById(uid);
  return resolveSnipSettings(user?.snipSettings ?? null);
}

/**
 * Writes the settings map and, when the retention window changed, re-stamps
 * every existing snip's `expiresAt`.
 *
 * **Re-stamping is the product decision, not an implementation detail.** A user
 * who switches to "1 month" means their screenshots stop living for six; one who
 * switches to "Never" means the ones they already have stop expiring. Leaving
 * old rows on their original window would make the setting silently apply to a
 * future the user cannot see.
 *
 * `bulkWriter()` rather than chunked batches (rule 9), and the expiry is
 * recomputed from each row's **own `createdAt`** — not from now — so switching
 * 6m → 1m deletes the four-month-old snips on the next cron tick, which is what
 * the words say.
 */
export async function saveSnipSettings(uid: string, next: SnipSettings): Promise<SnipSettings> {
  const previous = await getSnipSettings(uid);

  await adminDb.collection('users').doc(uid).update({
    snipSettings: next,
    updatedAt: FieldValue.serverTimestamp(),
  });
  // Rule 2 — `getUserById` caches for 60s and the renderer re-reads settings
  // immediately to push them to Electron.
  invalidateUserCache(uid);

  if (previous.retention !== next.retention) {
    await restampRetention(uid, next.retention);
  }

  return next;
}

async function restampRetention(uid: string, retention: SnipRetention): Promise<void> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('ownerUid', '==', uid)
    .select('createdAt')
    .get();
  if (snap.empty) return;

  const writer = adminDb.bulkWriter();
  for (const doc of snap.docs) {
    const createdAtMs = doc.get('createdAt')?.toDate?.()?.getTime?.();
    // A row mid-upload has no `createdAt` yet; `finalizeSnip` stamps both
    // together, so skipping it here loses nothing.
    if (!createdAtMs) continue;
    const expiresMs = snipExpiryMs(createdAtMs, retention);
    writer.update(doc.ref, {
      retention,
      // DELETED, not set to null, under a `never` retention. Firestore orders
      // null before every other value, so a stored null would MATCH the sweep's
      // `expiresAt <= now` and delete exactly the snips the user asked to keep
      // forever. An absent field is excluded from an inequality filter, which
      // is the guarantee "never" rests on. See `sweepExpiredSnips`.
      expiresAt: expiresMs == null ? FieldValue.delete() : Timestamp.fromMillis(expiresMs),
    });
  }
  await writer.close();
}

// ─── Capture → upload → finalise ─────────────────────────────────────

/**
 * Reserves a snip id and signs the slot its bytes go into.
 *
 * **The bytes never cross Vercel** (rule 9i): the renderer PUTs the PNG straight
 * to Cloud Storage with the URL returned here, then calls `finalizeSnip` with
 * nothing but dimensions. A full-screen PNG is routinely 3–8 MB and base64 would
 * add a third on top of that, all of it billed as Fast Origin Transfer for bytes
 * whose only destination is a bucket.
 *
 * The id is minted here rather than at finalise time so the storage path is
 * derived from it, which makes the object addressable from the row and the row
 * from the object — a half-finished upload leaves one orphaned object under a
 * path nothing else can collide with, and the cleanup below sweeps it.
 *
 * The signature pins the content type, so a caller cannot PUT something that is
 * not a PNG under a URL we signed.
 */
export async function createSnipUploadSlot(
  uid: string,
  bytes: number,
  kind: SnipKind = 'image',
): Promise<{
  id: string;
  uploadUrl: string;
  resumable: boolean;
  posterUploadUrl?: string;
} | null> {
  // The two kinds have their own ceilings and they are an order of magnitude
  // apart: a still that claims 40 MB is not a still, while a ten-minute
  // recording legitimately is. Sharing one limit would mean either refusing
  // real recordings or waving through absurd screenshots.
  const maxBytes = kind === 'video' ? MAX_SNIP_VIDEO_BYTES : MAX_SNIP_BYTES;
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > maxBytes) return null;

  const count = await adminDb
    .collection(COLLECTION)
    .where('ownerUid', '==', uid)
    .count()
    .get();
  if (count.data().count >= MAX_SNIPS_PER_USER) {
    throw new SnipQuotaError();
  }

  const id = mintSnipId();
  // **No uid in the path.** The object is reachable by signed URL, and a signed
  // URL is a place a uid can end up visible — in an address bar, a referrer, a
  // pasted link. `id` is already 160 bits of unguessable, globally unique token,
  // so a per-user folder bought nothing except that exposure. Ownership lives on
  // the Firestore doc (`ownerUid`), which is where it is actually enforced.
  //
  // Older snips still carry `snips/{uid}/{id}.png`; every read and delete path
  // resolves `storagePath` from the document rather than rebuilding it, so both
  // layouts work and no migration is required.
  const video = kind === 'video';
  const contentType = video ? SNIP_VIDEO_CONTENT_TYPE : SNIP_CONTENT_TYPE;
  const storagePath = `${SNIP_STORAGE_PREFIX}/${id}.${video ? 'webm' : 'png'}`;
  // A recording's poster is a second object under the same token. It shares the
  // row's lifetime exactly — every delete path below removes both — so it needs
  // no id of its own, and deriving the name means a poster can never be orphaned
  // by a row whose path it does not match.
  const posterPath = video ? `${SNIP_STORAGE_PREFIX}/${id}-poster.png` : null;

  // The pending row is what makes the object reachable before the renderer
  // confirms the upload — without it, a PUT that succeeds and a finalise that
  // never arrives (the window closed, the machine slept) leaks an object nothing
  // knows the name of.
  await adminDb.collection(COLLECTION).doc(id).set({
    ownerUid: uid,
    storagePath,
    contentType,
    kind,
    ...(posterPath ? { posterPath } : {}),
    status: 'pending',
    reservedAt: FieldValue.serverTimestamp(),
  });

  const bucket = adminStorage.bucket();
  const sign = (path: string, type: string) =>
    bucket.file(path).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + SIGNED_WRITE_TTL_MS,
      contentType: type,
    });

  /**
   * A recording is signed for a **resumable** session, not a single PUT.
   *
   * This is the difference between "a long upload survives a bad connection"
   * and "a long upload starts again from zero every time the wifi blinks". A
   * plain `PUT` of 300 MB is one indivisible request: interrupt it at 95% and
   * every byte has to be sent again, which on a connection bad enough to drop
   * it once is a loop that may never terminate. A resumable session is
   * chunked, and an interrupted one is continued from the offset the bucket
   * confirms it already holds.
   *
   * The URL returned here is the **initiation** endpoint: main POSTs to it
   * with `x-goog-resumable: start` and gets a session URI back in `Location`.
   * `extensionHeaders` is not optional — that header is part of the v4
   * signature, so a POST without it is rejected as a signature mismatch.
   *
   * The poster stays a simple signed `write`: it is one small PNG, and a
   * resumable session for 80 KB is pure overhead.
   */
  const signResumable = (path: string, type: string) =>
    bucket.file(path).getSignedUrl({
      version: 'v4',
      action: 'resumable',
      expires: Date.now() + SIGNED_WRITE_TTL_MS,
      contentType: type,
      extensionHeaders: { 'x-goog-resumable': 'start' },
    });

  // Both slots are signed here rather than the poster getting a round-trip of
  // its own. The recorder holds the poster from the moment recording starts and
  // the two uploads are back to back; a second call would be a second
  // authenticated origin request (rule 9i) for a URL we can mint in the same
  // breath as the first.
  const [[uploadUrl], poster] = await Promise.all([
    video ? signResumable(storagePath, contentType) : sign(storagePath, contentType),
    posterPath ? sign(posterPath, SNIP_CONTENT_TYPE) : Promise.resolve(null),
  ]);

  return {
    id,
    uploadUrl,
    // Named so the caller cannot mistake one protocol for the other. Main
    // branches on this rather than on the kind, because the kind is a product
    // fact and this is a wire fact.
    resumable: video,
    ...(poster ? { posterUploadUrl: poster[0] } : {}),
  };
}

export class SnipQuotaError extends Error {
  constructor() {
    super(`You have reached the ${MAX_SNIPS_PER_USER}-snip limit. Delete some to capture more.`);
    this.name = 'SnipQuotaError';
  }
}

/**
 * Turns a pending reservation into a live snip, once its bytes are in the
 * bucket.
 *
 * **The object's real size is read from Storage, not taken from the caller.**
 * The renderer's number is a claim about a file we did not receive; the bucket
 * knows. That also doubles as the proof the PUT actually happened — a missing
 * object fails here rather than producing a row whose link 404s.
 */
export async function finalizeSnip(
  uid: string,
  id: string,
  width: number,
  height: number,
  durationMs?: number,
): Promise<SnipRow | null> {
  if (!isValidSnipId(id)) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }

  const ref = adminDb.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  const data = snap.data();
  // Ownership, not just existence: the id is unguessable, but a route that
  // finalises whatever id it is handed is still a route that writes another
  // user's row.
  if (!data || data.ownerUid !== uid || data.status !== 'pending') return null;

  // The kind is read off the RESERVATION, never off the request body. The slot
  // was signed for one content type and one path from that decision; letting the
  // finalise call rename it would mean a row claiming to be a recording over an
  // object that is a PNG, or the reverse.
  const kind = resolveSnipKind(data.kind);
  const video = kind === 'video';

  const bucket = adminStorage.bucket();
  const file = bucket.file(data.storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [metadata] = await file.getMetadata();
  const bytes = Number(metadata.size ?? 0);
  const maxBytes = video ? MAX_SNIP_VIDEO_BYTES : MAX_SNIP_BYTES;
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > maxBytes) {
    // Oversized or empty: the object is the only evidence, so remove it rather
    // than leave an unreferenced blob behind a row we are about to refuse. The
    // poster goes with it — a poster for a recording that will not exist is the
    // orphan this whole path is trying not to create.
    await Promise.all([
      file.delete({ ignoreNotFound: true }).catch(() => {}),
      data.posterPath
        ? bucket.file(data.posterPath).delete({ ignoreNotFound: true }).catch(() => {})
        : Promise.resolve(),
    ]);
    return null;
  }

  // Clamped rather than refused. The duration is the recorder's own wall clock
  // and the only source there is — the container's is not readable without
  // parsing the WebM — so a nonsense value costs a wrong caption, not a wrong
  // file, and refusing the upload over it would throw away a recording the user
  // has already waited for.
  const duration = video
    ? Math.min(Math.max(Math.round(Number(durationMs) || 0), 0), MAX_SNIP_RECORDING_MS)
    : null;

  // A recording whose poster PUT failed is still a recording. The row simply
  // drops the field, `imageUrl` comes back null, and the card renders its
  // placeholder — far better than refusing to save the video over its thumbnail.
  let posterPath: string | null = data.posterPath ?? null;
  if (posterPath) {
    const [posterExists] = await bucket
      .file(posterPath)
      .exists()
      .catch(() => [false] as [boolean]);
    if (!posterExists) posterPath = null;
  }

  const retention = (await getSnipSettings(uid)).retention;
  const createdAt = new Date();
  const expiresMs = snipExpiryMs(createdAt.getTime(), retention);

  await ref.update({
    status: 'ready',
    width,
    height,
    bytes,
    retention,
    ...(duration == null ? {} : { durationMs: duration }),
    ...(data.posterPath && !posterPath ? { posterPath: FieldValue.delete() } : {}),
    createdAt: Timestamp.fromDate(createdAt),
    // Absent, never null, under a `never` retention — see `restampRetention`.
    ...(expiresMs == null ? {} : { expiresAt: Timestamp.fromMillis(expiresMs) }),
    reservedAt: FieldValue.delete(),
  });

  return {
    id,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresMs == null ? null : new Date(expiresMs).toISOString(),
    kind,
    durationMs: duration,
    width,
    height,
    bytes,
    shareUrl: snipShareUrl(id),
    imageUrl: video && !posterPath ? null : snipImageUrl(id),
    mediaUrl: snipMediaUrl(id, kind),
  };
}
// ─── Reads ───────────────────────────────────────────────────────────

/**
 * One page of the library grid.
 *
 * Small on purpose. Every row carries an image the browser will ask for, and
 * each of those is a redirect through a Vercel function — so an unpaged list is
 * not one expensive response, it is one response plus up to five hundred origin
 * requests (rule 9i). A page is what the grid can show before the user has
 * scrolled anywhere.
 */
export const SNIP_PAGE_SIZE = 24;

/** The most a caller may ask for in one page, whatever it sends. */
const MAX_SNIP_PAGE_SIZE = 60;

/**
 * `{createdAt ms}.{document id}` — both halves, because each covers the other's
 * failure. The id gives an exact, tie-proof cursor while the row still exists;
 * the timestamp is what remains usable when the user deletes that very row
 * before scrolling on, which would otherwise restart the list from the top.
 */
function snipCursor(createdAtMs: number, id: string): string {
  return `${createdAtMs}.${id}`;
}

function parseSnipCursor(cursor: string): { ms: number; id: string } | null {
  const dot = cursor.indexOf('.');
  if (dot <= 0) return null;
  const ms = Number(cursor.slice(0, dot));
  const id = cursor.slice(dot + 1);
  if (!Number.isFinite(ms) || ms <= 0 || !isValidSnipId(id)) return null;
  return { ms, id };
}

function toSnipRow(doc: FirebaseFirestore.QueryDocumentSnapshot): SnipRow {
  const d = doc.data();
  const kind = resolveSnipKind(d.kind);
  return {
    id: doc.id,
    createdAt: d.createdAt?.toDate?.()?.toISOString() ?? new Date(0).toISOString(),
    expiresAt: d.expiresAt?.toDate?.()?.toISOString() ?? null,
    kind,
    durationMs: typeof d.durationMs === 'number' ? d.durationMs : null,
    width: d.width ?? 0,
    height: d.height ?? 0,
    bytes: d.bytes ?? 0,
    shareUrl: snipShareUrl(doc.id),
    // An image is always its own still. A recording has one only if its poster
    // landed — `posterPath` is deleted at finalise when it did not, so its
    // presence here is the answer rather than an assumption about the object.
    imageUrl: kind === 'video' && !d.posterPath ? null : snipImageUrl(doc.id),
    mediaUrl: snipMediaUrl(doc.id, kind),
  };
}

/**
 * The owner's own snips, newest first. `status == 'ready'` only — a pending
 * reservation is not a thing anyone can look at.
 *
 * Ordering and filters match the existing composite index exactly, and the
 * cursor rides the same ordering, so paging adds no index (rule 1: nothing to
 * deploy). The only extra read a page costs is the cursor document itself.
 */
export async function listSnipPage(
  uid: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<SnipPage> {
  const size = Math.min(
    Math.max(Math.floor(options.limit ?? SNIP_PAGE_SIZE), 1),
    MAX_SNIP_PAGE_SIZE,
  );
  const cursor = options.cursor ?? null;

  let query = adminDb
    .collection(COLLECTION)
    .where('ownerUid', '==', uid)
    .where('status', '==', 'ready')
    .orderBy('createdAt', 'desc')
    .limit(size);

  if (cursor) {
    const parsed = parseSnipCursor(cursor);
    // A malformed cursor is a client the server does not recognise, not a
    // reason to hand back page one — that would loop the grid on itself.
    if (!parsed) return { snips: [], nextCursor: null, total: null };

    const cursorDoc = await adminDb.collection(COLLECTION).doc(parsed.id).get();
    query = cursorDoc.exists && cursorDoc.get('createdAt')
      ? query.startAfter(cursorDoc)
      : query.startAfter(Timestamp.fromMillis(parsed.ms));
  }

  const [snap, count] = await Promise.all([
    query.get(),
    cursor
      ? null
      : adminDb
          .collection(COLLECTION)
          .where('ownerUid', '==', uid)
          .where('status', '==', 'ready')
          .count()
          .get(),
  ]);

  const snips = snap.docs.map(toSnipRow);
  const last = snap.docs[snap.docs.length - 1];
  // A full page means "there may be more", not "there is more" — an exactly
  // divisible list costs one empty fetch at the end, which is cheaper than the
  // extra row every page would otherwise have to read to know.
  const nextCursor =
    last && snap.docs.length === size
      ? snipCursor(last.get('createdAt')?.toDate?.()?.getTime?.() ?? 0, last.id)
      : null;

  return { snips, nextCursor, total: count ? count.data().count : null };
}

/**
 * The public projection — everything an anonymous visitor holding the link can
 * ever see, and nothing else.
 *
 * Note what is absent and must stay absent: the owner's uid, their email, the
 * storage path, the retention window, the byte size. `sharedBy` is the
 * `displayName` alone, resolved through the cached `getUserById`, because a
 * forwarded link must not become a staff directory entry.
 *
 * One `null` covers every refusal — unknown token, deleted snip, still-pending
 * upload, expired row the cron has not swept yet. Distinguishing them would tell
 * a stranger which tokens once existed.
 */
export async function getPublicSnip(id: string): Promise<PublicSnip | null> {
  if (!isValidSnipId(id)) return null;

  const snap = await adminDb.collection(COLLECTION).doc(id).get();
  const d = snap.data();
  if (!d || d.status !== 'ready') return null;

  // A row past its expiry stops resolving the moment it is past it, rather than
  // whenever the daily cron next runs. The cron reclaims the bytes; this is what
  // makes the *promise* ("deleted after 6 months") true to the hour.
  const expiresMs = d.expiresAt?.toDate?.()?.getTime?.();
  if (expiresMs && expiresMs <= Date.now()) return null;

  const owner = await getUserById(d.ownerUid).catch(() => null);
  const kind = resolveSnipKind(d.kind);

  return {
    id,
    createdAt: d.createdAt?.toDate?.()?.toISOString() ?? new Date(0).toISOString(),
    kind,
    // Shown as a caption, and it is the one number that lets a recipient decide
    // whether to press play — but note what it still is not: a byte size. How
    // large the file is remains the owner's business.
    durationMs: typeof d.durationMs === 'number' ? d.durationMs : null,
    width: d.width ?? 0,
    height: d.height ?? 0,
    sharedBy: owner?.displayName?.trim() || null,
    imageUrl: kind === 'video' && !d.posterPath ? null : snipImageUrl(id),
    mediaUrl: snipMediaUrl(id, kind),
  };
}

/**
 * A short-lived signed read URL for a live snip, or null.
 *
 * The public image route redirects to this rather than streaming the object, so
 * the PNG travels bucket → recipient and never bucket → function → recipient
 * (rule 9i). It re-applies the same liveness checks as `getPublicSnip`: the
 * image endpoint is reachable on its own, so it cannot lean on the page having
 * checked.
 */
export async function getSnipMediaRedirect(
  id: string,
  /**
   * `'still'` is the PNG a page renders in an `<img>` — the capture for an
   * image snip, the poster frame for a recording. `'video'` is the WebM.
   *
   * The two are separate **routes** but one resolver, because every liveness
   * rule above has to hold identically for both: a deleted snip must stop
   * serving its poster at the same instant it stops serving its video.
   */
  want: 'still' | 'video' = 'still',
): Promise<string | null> {
  if (!isValidSnipId(id)) return null;

  const snap = await adminDb.collection(COLLECTION).doc(id).get();
  const d = snap.data();
  if (!d || d.status !== 'ready') return null;

  const expiresMs = d.expiresAt?.toDate?.()?.getTime?.();
  if (expiresMs && expiresMs <= Date.now()) return null;

  const kind = resolveSnipKind(d.kind);
  // Asking the video route for a still, or the image route for a recording, is
  // a caller that has the wrong URL for this row — one 404, like every other
  // refusal here, rather than quietly serving the other object.
  const path =
    want === 'video'
      ? kind === 'video'
        ? d.storagePath
        : null
      : kind === 'video'
        ? d.posterPath ?? null
        : d.storagePath;
  if (!path) return null;

  const [url] = await adminStorage
    .bucket()
    .file(path)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_READ_TTL_MS,
    });
  return url;
}

// ─── Delete ──────────────────────────────────────────────────────────

/**
 * Deletes one snip — the object first, then the row.
 *
 * That order is deliberate. A row with no object renders a broken image on a
 * page someone may already have sent; an object with no row is unreachable
 * bytes that the pending sweep below eventually reclaims. If only one half can
 * succeed, the harmless failure is the one to leave behind.
 */
export async function deleteSnip(uid: string, id: string): Promise<boolean> {
  if (!isValidSnipId(id)) return false;

  const ref = adminDb.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  const d = snap.data();
  if (!d || d.ownerUid !== uid) return false;

  const bucket = adminStorage.bucket();
  // Both objects, and the poster's failure must not block the row. A poster
  // left behind is an unreachable thumbnail; a row left behind is a live link
  // to a recording the user asked to delete, which is the failure that matters.
  await bucket.file(d.storagePath).delete({ ignoreNotFound: true });
  if (d.posterPath) {
    await bucket.file(d.posterPath).delete({ ignoreNotFound: true }).catch(() => {});
  }
  await ref.delete();
  return true;
}

/** Every object one row owns — the media, plus a recording's poster. */
function snipObjectPaths(doc: FirebaseFirestore.QueryDocumentSnapshot): string[] {
  return [doc.get('storagePath'), doc.get('posterPath')].filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  );
}

/** Every snip a user owns, for the account-deletion cascade (rule 6). */
export async function deleteAllSnipsForUser(uid: string): Promise<number> {
  const snap = await adminDb.collection(COLLECTION).where('ownerUid', '==', uid).get();
  if (snap.empty) return 0;

  const bucket = adminStorage.bucket();
  await Promise.all(
    snap.docs.flatMap(doc =>
      snipObjectPaths(doc).map(path =>
        bucket.file(path).delete({ ignoreNotFound: true }).catch(() => {}),
      ),
    ),
  );

  const writer = adminDb.bulkWriter();
  for (const doc of snap.docs) writer.delete(doc.ref);
  await writer.close();

  return snap.size;
}

// ─── Retention sweep (cron) ──────────────────────────────────────────

/**
 * The daily sweep: expired snips, then abandoned reservations.
 *
 * Capped per run rather than unbounded — this is a Vercel function with a wall
 * clock, and a backlog that cannot finish in one invocation is better finished
 * across several days than left half-committed by a timeout.
 */
export async function sweepExpiredSnips(limit = 500): Promise<{ expired: number; abandoned: number }> {
  const bucket = adminStorage.bucket();
  const now = Timestamp.now();

  // Matches only rows that HAVE an `expiresAt`. A `never` retention leaves the
  // field absent precisely so it falls outside this filter — writing null there
  // would sort before every timestamp and put those rows first in line for
  // deletion. See `finalizeSnip`.
  const expiredSnap = await adminDb
    .collection(COLLECTION)
    .where('expiresAt', '<=', now)
    .limit(limit)
    .get();

  const abandonedSnap = await adminDb
    .collection(COLLECTION)
    .where('status', '==', 'pending')
    .where('reservedAt', '<=', Timestamp.fromMillis(Date.now() - PENDING_UPLOAD_TTL_MS))
    .limit(limit)
    .get();

  const docs = [...expiredSnap.docs, ...abandonedSnap.docs];
  if (docs.length === 0) return { expired: 0, abandoned: 0 };

  await Promise.all(
    docs.flatMap(doc =>
      snipObjectPaths(doc).map(path =>
        bucket
          .file(path)
          .delete({ ignoreNotFound: true })
          .catch(err => {
            // One unreachable object must not abort the sweep — the row stays
            // and the next run retries it. The id is a share token, so it is
            // NOT logged; the storage path names the object well enough to find
            // it and is the same secret, which is why only the message is kept.
            console.error('[snips] object delete failed:', err?.message);
          }),
      ),
    ),
  );

  const writer = adminDb.bulkWriter();
  for (const doc of docs) writer.delete(doc.ref);
  await writer.close();

  return { expired: expiredSnap.size, abandoned: abandonedSnap.size };
}

export { DEFAULT_SNIP_SETTINGS, MAX_SNIPS_PER_USER, SNIPPING_TOOL_PAGE_ID };
