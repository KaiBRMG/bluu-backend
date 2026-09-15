/**
 * Creator avatars: one place that decides how they are encoded and stored.
 *
 * Every creator photo in the system is a **WebP**, written to a deterministic
 * path with a long-lived immutable cache header. Both the upload route and the
 * backfill go through here, so there is exactly one answer to "what format is a
 * creator avatar" rather than two that drift.
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

export interface StoredCreatorPhoto {
  photoURL: string;
  photoStoragePath: string;
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

  return { photoURL: creatorPhotoUrl(filePath, downloadToken), photoStoragePath: filePath, bytes: webp.length };
}
