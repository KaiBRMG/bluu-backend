/**
 * Shared rules for staging an outgoing OnlyFans attachment.
 *
 * Deliberately **not** under `src/lib/onlyfans/` — everything there is
 * server-only (it reads `ONLYFANSAPI_API_KEY` through the factory), and the
 * composer needs these same limits to reject a 400MB drop before it starts
 * uploading it. This file is pure data and imports nothing.
 *
 * The upload path itself is three hops, and the reason is Vercel: a serverless
 * function accepts about 4.5MB of request body, which a single phone video
 * blows past. So the bytes never touch our function —
 *
 *   1. `POST /api/onlyfans/media/upload-url` signs a one-off GCS PUT,
 *   2. the browser PUTs the file straight to Storage,
 *   3. `POST /api/onlyfans/media/upload` signs a short read URL and hands *that*
 *      to the provider, which fetches the file itself.
 *
 * See documentation/onlyfans-crm.md § Sending media.
 */

/** Where staged uploads live until the provider has fetched them. */
export const OF_UPLOAD_PREFIX = 'onlyfans-outgoing';

/**
 * 100MB. The provider's own direct-upload path caps at 100MB (Cloudflare), and
 * while `file_url` can go higher on some plans, matching the documented figure
 * keeps one number in the UI and the route.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * What OnlyFans actually accepts as message media. An allowlist rather than a
 * blocklist because this decides what a signed URL will accept: a permissive
 * rule here turns the bucket into open file hosting.
 */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
};

/** The `accept` attribute for the composer's file input, from the one allowlist. */
export const UPLOAD_ACCEPT = Object.keys(ALLOWED_UPLOAD_TYPES).join(',');

/**
 * How many attachments may ride on one message.
 *
 * The provider documents no ceiling; this one is ours, and it is a cost control
 * as much as a UI one — every staged file is a billed upload, and a mis-drop of
 * a whole folder should fail loudly rather than quietly bill for forty.
 */
export const MAX_MESSAGE_MEDIA = 10;

/** PPV bounds the provider enforces: free, or between these two. */
export const MIN_PPV_PRICE = 3;
export const MAX_PPV_PRICE = 200;

/** Is this a price the provider will accept? `0` means "free", not "unset". */
export function isValidPpvPrice(price: number): boolean {
  if (!Number.isFinite(price)) return false;
  if (price === 0) return true;
  return price >= MIN_PPV_PRICE && price <= MAX_PPV_PRICE;
}

/** Human-readable reason a file cannot be staged, or null when it can. */
export function rejectUpload(file: { type: string; size: number }): string | null {
  if (!ALLOWED_UPLOAD_TYPES[file.type]) return 'That file type cannot be sent on OnlyFans.';
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is over ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`;
  }
  return null;
}
