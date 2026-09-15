/**
 * Creator avatars: one place that decides how they are encoded and stored.
 *
 * Every creator photo in the system is a **WebP**, written to a deterministic
 * path with a long-lived immutable cache header. Both the upload route and the
 * backfill go through here, so there is exactly one answer to "what format is a
 * creator avatar" rather than two that drift.
 *
 * Each photo produces **two** artefacts, and the distinction matters:
 *
 * - a **256px object in Storage** (`photoURL`) — the canonical image, for a
 *   detail view or a surface that cannot reach the shared roster;
 * - a **64px `data:` URI on the creator doc** (`photoThumb`) — what every
 *   avatar in the internal app actually renders, delivered inline with the
 *   roster so no avatar costs an HTTP request. See `encodeCreatorThumb`.
 *
 * ## Why WebP
 *
 * These are rendered at 16–40px and there are now thirty-odd of them on a shift
 * calendar. A phone-camera JPEG at 2MB to fill a 20px circle is absurd; resized
 * to a 256px edge and WebP-encoded it lands in single-digit KB, typically a
 * 50–200× reduction. WebP is supported by every browser this app runs in
 * (Electron/Chromium, and Chrome/Safari/Firefox for the web surfaces), so there
 * is no fallback format to maintain.
 *
 * ## Why decode rather than trust the MIME string
 *
 * The client's `contentType` is a claim, not a fact. `sharp` must be able to
 * decode the bytes and report a whitelisted format, which rules out renamed
 * archives, SVG payloads and polyglot files. Re-encoding also strips EXIF —
 * including any GPS coordinates that came off a phone (rule 10). This mirrors
 * `modelSubmissionService.ingestImage`, which is the house pattern.
 */

import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { adminStorage } from '../firebase-admin';
import { ALLOWED_IMAGE_FORMATS } from '../modelSubmissions';

/**
 * How long a browser may hold a creator avatar.
 *
 * A week, and `immutable`, because the download URL carries a token regenerated
 * on every upload — replacing a photo yields a *different* URL, so no cache can
 * be holding stale bytes for a live URL. `private` rather than `public` because
 * these sit behind a download token and are staff-facing, matching
 * `onlyfansMediaCache.ts`.
 */
export const CREATOR_PHOTO_CACHE_CONTROL = 'private, max-age=604800, immutable';

/** Every creator avatar is a WebP. There is no second format. */
export const CREATOR_PHOTO_CONTENT_TYPE = 'image/webp';
export const CREATOR_PHOTO_EXTENSION = 'webp';

/**
 * Longest edge, in pixels.
 *
 * The largest place one renders today is `size-10` (40px); 256 leaves headroom
 * for a detail view and for 3× displays without storing anything like a full
 * photo.
 */
const MAX_EDGE = 256;

/** Matches `modelSubmissionService`'s full-size quality. Visually lossless at this scale. */
const WEBP_QUALITY = 88;

/** Guards against a decompression bomb, same ceiling as the public upload path. */
const LIMIT_INPUT_PIXELS = 80_000_000;

/**
 * Longest edge of the **inline thumbnail**, in pixels.
 *
 * Separate from `MAX_EDGE` because it is solving a different problem. The 256px
 * object exists so a detail view has something to show; the thumbnail exists so
 * the *calendar* never issues an image request at all.
 *
 * 64 is not arbitrary: the largest place a creator avatar is drawn from the
 * shared roster is `size-8` (32px, the creator-management table), and every
 * other call site is 16–24px. 64 covers the largest of those exactly on a 2×
 * display, so the thumbnail is never upscaled anywhere it is used.
 */
const THUMB_EDGE = 64;

/**
 * Lower than `WEBP_QUALITY` on purpose — these bytes are inlined into a JSON
 * response, so every KB is paid by every consumer of the roster, and the
 * artefacts a 68 introduces are invisible in a 20px circle.
 */
const THUMB_QUALITY = 68;

/**
 * Hard ceiling on one inlined thumbnail.
 *
 * The thumbnail is an *optimisation*, so it must never become the problem: a
 * pathological source (heavy noise, which WebP does not like) that encodes
 * above this is dropped rather than stored, and that creator simply falls back
 * to `photoURL` like they did before. Typical output is 1–3KB.
 */
export const MAX_CREATOR_THUMB_BYTES = 6 * 1024;

export const MAX_CREATOR_PHOTO_BYTES = 5 * 1024 * 1024;

/** A rejection the caller should surface to the admin verbatim. */
export class CreatorPhotoRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreatorPhotoRejected';
  }
}

/** The canonical Storage path for a creator's avatar. Deterministic — one photo per creator. */
export function creatorPhotoPath(creatorId: string): string {
  return `creator-photos/${creatorId}/avatar.${CREATOR_PHOTO_EXTENSION}`;
}

/** Firebase's download URL for a stored object and its token. */
export function creatorPhotoUrl(filePath: string, downloadToken: string): string {
  const bucketName = adminStorage.bucket().name;
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    filePath,
  )}?alt=media&token=${downloadToken}`;
}

/**
 * Decode, validate, square-crop and re-encode to WebP.
 *
 * `fit: 'cover'` rather than `'inside'`: an avatar is always rendered in a
 * circle, so a non-square source would be cropped by CSS anyway — doing it here
 * means the stored bytes are the bytes displayed, and no pixel is downloaded to
 * be thrown away. `withoutEnlargement` keeps a small source small rather than
 * upscaling it into blur.
 */
export async function encodeCreatorPhoto(buffer: Buffer): Promise<Buffer> {
  if (buffer.length === 0) throw new CreatorPhotoRejected('That file is empty.');
  if (buffer.length > MAX_CREATOR_PHOTO_BYTES) {
    throw new CreatorPhotoRejected('That image is too large — keep it under 5MB.');
  }

  let format: string;
  try {
    const metadata = await sharp(buffer, { limitInputPixels: LIMIT_INPUT_PIXELS, animated: false }).metadata();
    format = metadata.format ?? '';
  } catch {
    throw new CreatorPhotoRejected("That file isn't a readable image.");
  }

  if (!(ALLOWED_IMAGE_FORMATS as readonly string[]).includes(format)) {
    throw new CreatorPhotoRejected('Please upload a JPEG, PNG or WebP image.');
  }

  try {
    return await sharp(buffer, { limitInputPixels: LIMIT_INPUT_PIXELS, animated: false })
      // Honours EXIF orientation before the crop, so a phone photo is not
      // sideways — and drops the EXIF block with it.
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'cover', position: 'attention', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (error) {
    console.error('[creatorPhoto] encode failed:', error);
    throw new CreatorPhotoRejected('That image could not be processed. Try a different photo.');
  }
}

/**
 * Encode the inline thumbnail: a `data:` URI small enough to travel with the
 * roster JSON.
 *
 * ## Why this exists
 *
 * A shift calendar draws thirty-odd avatars, and each one used to be its own
 * cross-origin request to `firebasestorage.googleapis.com` — a host that is not
 * a CDN and that validates the `?token=` on every request. The bytes were never
 * the problem; **thirty round trips of latency** were, and each one was an
 * independent chance to fail. Radix's `Avatar.Image` has no retry, so a single
 * transient 5xx stranded that creator on their initials until the next mount.
 *
 * Inlining the thumbnail on the creator doc removes the request entirely: the
 * avatar arrives in the same payload as the name and paints in the same frame.
 * There is nothing left to be slow, and nothing left to fail.
 *
 * ## Why it is encoded from the 256px WebP, not the original
 *
 * The 256px object has already been EXIF-rotated and attention-cropped, so
 * re-deriving from it guarantees the thumbnail is the same crop as the full
 * image — two independent `position: 'attention'` passes over different
 * resolutions can legitimately choose different crops, which would show as the
 * face jumping when a surface upgrades from thumb to full. It is also far
 * cheaper: decoding a 256px WebP instead of a full-resolution phone JPEG a
 * second time.
 *
 * Returns `null` rather than throwing. A creator without a thumbnail renders
 * from `photoURL` exactly as before, so a failure here degrades the
 * optimisation and never the feature.
 */
export async function encodeCreatorThumb(webp: Buffer): Promise<string | null> {
  try {
    const thumb = await sharp(webp, { limitInputPixels: LIMIT_INPUT_PIXELS, animated: false })
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();

    if (thumb.length > MAX_CREATOR_THUMB_BYTES) return null;

    return `data:${CREATOR_PHOTO_CONTENT_TYPE};base64,${thumb.toString('base64')}`;
  } catch (error) {
    console.error('[creatorPhoto] thumb encode failed:', error);
    return null;
  }
}

export interface StoredCreatorPhoto {
  photoURL: string;
  photoStoragePath: string;
  /** Inline `data:` URI, or `null` when one could not be produced. */
  photoThumb: string | null;
  bytes: number;
}

/**
 * Encode and store a creator's avatar, replacing whatever was there.
 *
 * `previousPath` is deleted when it differs from the canonical one — which is
 * exactly the case for every pre-WebP photo (`avatar.jpg`, `avatar.png`).
 * Without that, converting the fleet would leave an orphaned original beside
 * every avatar.
 */
export async function storeCreatorPhoto(
  creatorId: string,
  buffer: Buffer,
  uploadedBy: string,
  previousPath?: string | null,
): Promise<StoredCreatorPhoto> {
  const webp = await encodeCreatorPhoto(buffer);

  const filePath = creatorPhotoPath(creatorId);
  const bucket = adminStorage.bucket();
  const downloadToken = randomUUID();

  await bucket.file(filePath).save(webp, {
    metadata: {
      contentType: CREATOR_PHOTO_CONTENT_TYPE,
      cacheControl: CREATOR_PHOTO_CACHE_CONTROL,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        uploadedBy,
        uploadedAt: new Date().toISOString(),
      },
    },
  });

  // Best-effort: an orphaned object costs storage, not correctness, so a failure
  // here must not fail an upload that has already succeeded.
  if (previousPath && previousPath !== filePath) {
    await bucket
      .file(previousPath)
      .delete()
      .catch(() => null);
  }

  return {
    photoURL: creatorPhotoUrl(filePath, downloadToken),
    photoStoragePath: filePath,
    photoThumb: await encodeCreatorThumb(webp),
    bytes: webp.length,
  };
}
