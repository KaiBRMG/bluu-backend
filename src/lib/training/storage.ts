import 'server-only';
import { adminStorage } from '@/lib/firebase-admin';
import { IMAGE_TYPES, type ImageSniff } from '@/lib/training/modules';

/**
 * Cloud Storage helpers for Training — signing and byte-sniffing. Nothing here
 * knows about modules or tests; paths are built by the caller.
 *
 *   training/materials/{moduleId}/datasets/{IDENTITY}/{driveId}-{md5}.{ext} (+ _thumb.webp)
 *   training/materials/{moduleId}/sources/{folder}/{driveId}-{md5}.{ext}    (+ _thumb.webp)
 *   training/submissions/{moduleId}/{emailHash}/{testId}/final/{slotId}-{uploadId}.{ext}
 *   training/submissions/{moduleId}/{emailHash}/{testId}/work/{uploadId}
 *   training/recordings/{moduleId}/{emailHash}/{testId}/seg-{NNNNNN}.{webm|mp4}, check-{id}.jpg
 */

export const STORAGE_ROOT = 'training';

/** Signed read URLs: from the start of the current window, this long. */
const READ_URL_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * A V4 signature covers the signing TIME, so signing on demand yields a
 * different URL string for the same file on every call — the browser then
 * re-downloads every image each time a page refreshes (the flicker documented
 * in model-submissions.md). Anchoring both ends to the start of a 30-minute
 * window makes every request inside it return byte-identical URLs. The TTL
 * outlives the window, so a URL minted in a window's last second still has well
 * over an hour left.
 */
export const URL_WINDOW_MS = 30 * 60 * 1000;

export async function signRead(path: string, opts?: { download?: string }): Promise<string> {
  const stamp = Math.floor(Date.now() / URL_WINDOW_MS) * URL_WINDOW_MS;
  const [url] = await adminStorage
    .bucket()
    .file(path)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      accessibleAt: new Date(stamp),
      expires: new Date(stamp + READ_URL_TTL_MS),
      ...(opts?.download
        ? { responseDisposition: `attachment; filename="${opts.download.replace(/["\\\r\n]/g, '_')}"` }
        : {}),
    });
  return url;
}

export async function signWrite(path: string, contentType: string, expiresAtMs: number): Promise<string> {
  const [url] = await adminStorage
    .bucket()
    .file(path)
    .getSignedUrl({ version: 'v4', action: 'write', expires: expiresAtMs, contentType });
  return url;
}

export function extFor(contentType: string): string | undefined {
  return (IMAGE_TYPES as Record<string, { ext: string } | undefined>)[contentType]?.ext;
}

/** The type of an image from its first bytes — never from a declared type or a file name. */
export function sniffBytes(b: Buffer): ImageSniff | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** The first bytes of a stored object, to prove what the declared type claims (a range read, not a download). */
export async function sniffImage(path: string): Promise<ImageSniff | null> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    adminStorage
      .bucket()
      .file(path)
      .createReadStream({ start: 0, end: 15 })
      .on('data', (c: Buffer) => chunks.push(c))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return sniffBytes(Buffer.concat(chunks));
}

/** Whether the bytes at `path` are the image type its declared content type claims. */
export async function isDeclaredImage(path: string, contentType: string): Promise<boolean> {
  const expected = (IMAGE_TYPES as Record<string, { sniff: ImageSniff } | undefined>)[contentType]?.sniff;
  return !!expected && (await sniffImage(path).catch(() => null)) === expected;
}

// ─── Per-attempt paths ───────────────────────────────────────────────────────

export const recordingBase = (moduleId: string, emailHash: string, testId: string) =>
  `${STORAGE_ROOT}/recordings/${moduleId}/${emailHash}/${testId}`;

export const submissionBase = (moduleId: string, emailHash: string, testId: string) =>
  `${STORAGE_ROOT}/submissions/${moduleId}/${emailHash}/${testId}`;

/**
 * What `getFiles` returns when `fields` is set: the raw JSON items, NOT `File`
 * instances, despite the SDK's typing. There is no `.metadata` — the requested
 * fields sit on the object itself (`size` as a string).
 */
export type ListedObject = { name: string; size?: string; timeCreated?: string };

/** When the newest recording segment finished uploading, by Storage's clock — 0 when there is none. */
export async function latestSegmentAtMs(base: string): Promise<number> {
  // Only the two fields read here: a long attempt holds hundreds of segments.
  const [files] = await adminStorage.bucket().getFiles({ prefix: `${base}/seg-`, fields: 'items(name,timeCreated),nextPageToken' });
  let latest = 0;
  for (const f of files as unknown as ListedObject[]) latest = Math.max(latest, Date.parse(String(f.timeCreated)) || 0);
  return latest;
}
