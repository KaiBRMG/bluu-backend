import { adminDb, adminStorage } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import type { ActivityMethod } from '@/types/firestore';

const COLLECTION = 'screenshots';

/** Screens per capture — one per display. */
export const MAX_SCREENS_PER_CAPTURE = 10;
/** A full-resolution PNG of a 6K display is ~10MB; past this it is not a screenshot. */
export const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
/** How long the renderer has to finish the PUTs. */
const SIGNED_WRITE_TTL_MS = 10 * 60 * 1000;


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCaptureGroupId(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * The one shape of a screenshot object: `screenshots/{uid}/{date}/{ts}_{captureGroup}_{i}.png`.
 * The capture group and index in the name are what let `finalise` check a slot
 * without storing it, and let the thumbnail function find its doc
 * (`{captureGroup}_{i}`) without a query.
 */
function screenshotPath(userId: string, at: Date, captureGroup: string, index: number): string {
  return `screenshots/${userId}/${at.toISOString().split('T')[0]}/${at.getTime()}_${captureGroup}_${index}.png`;
}
const SLOT_NAME_RE = /^\d{4}-\d{2}-\d{2}\/\d{13}_([0-9a-f-]{36})_(\d+)\.png$/;

/**
 * Sign one upload slot per screen. The path is **server-chosen** — the caller
 * picks neither folder nor name, so a signed URL can only ever write this
 * user's own capture (the same posture as the OnlyFans media upload). The
 * capture group id is embedded in each name, which is what lets `finalise`
 * check a path belongs to the capture it claims without storing the slots.
 */
export async function signScreenshotSlots(userId: string, count: number): Promise<{
  captureGroup: string;
  slots: Array<{ path: string; uploadUrl: string }>;
}> {
  const now = new Date();
  const captureGroup = randomUUID();
  const bucket = adminStorage.bucket();
  const slots = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const path = screenshotPath(userId, now, captureGroup, i);
      const [uploadUrl] = await bucket.file(path).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + SIGNED_WRITE_TTL_MS,
        contentType: 'image/png',
      });
      return { path, uploadUrl };
    }),
  );
  return { captureGroup, slots };
}

/** The slot path `signScreenshotSlots` would have produced for screen `index`. */
function isSlotPath(userId: string, captureGroup: string, index: number, path: unknown): path is string {
  if (typeof path !== 'string') return false;
  const prefix = `screenshots/${userId}/`;
  if (!path.startsWith(prefix)) return false;
  const match = SLOT_NAME_RE.exec(path.slice(prefix.length));
  return Boolean(match && match[1] === captureGroup && Number(match[2]) === index);
}

/**
 * Turn uploaded slots into screenshot docs. Every path must be a slot of this
 * capture, in order, and must actually exist in the bucket under the size
 * ceiling (an oversized object is deleted, not recorded). Doc ids are
 * `{captureGroup}_{index}`, so a retried finalise rewrites the same docs
 * rather than duplicating them.
 *
 * Returns null when the paths do not check out.
 */
export async function finaliseScreenshots(
  userId: string,
  captureGroup: string,
  paths: unknown[],
  activityPercent: number | null,
  activityMethod: ActivityMethod | null,
): Promise<string[] | null> {
  if (!isCaptureGroupId(captureGroup)) return null;
  if (paths.length === 0 || paths.length > MAX_SCREENS_PER_CAPTURE) return null;
  if (!paths.every((p, i) => isSlotPath(userId, captureGroup, i, p))) return null;

  const bucket = adminStorage.bucket();
  // One metadata call per screen proves both existence (a 404 throws) and size.
  const checks = await Promise.all(
    (paths as string[]).map(async path => {
      const file = bucket.file(path);
      const meta = await file.getMetadata().then(([m]) => m, () => null);
      if (!meta) return false;
      if (Number(meta.size) > MAX_SCREENSHOT_BYTES) {
        await file.delete().catch(() => {});
        return false;
      }
      return true;
    }),
  );
  if (!checks.every(Boolean)) return null;

  return writeScreenshotDocs(userId, captureGroup, paths as string[], activityPercent, activityMethod);
}

async function writeScreenshotDocs(
  userId: string,
  captureGroup: string,
  storagePaths: string[],
  activityPercent: number | null,
  activityMethod: ActivityMethod | null,
): Promise<string[]> {
  // Merged, and silent on `thumbnailPath`: the thumbnail function writes that
  // field into the same deterministic doc id, in whichever order the two land
  // (the bytes reach Storage before this runs). Readers treat an absent
  // thumbnail as "use the full image".
  const batch = adminDb.batch();
  const ids = storagePaths.map((storagePath, i) => {
    const ref = adminDb.collection(COLLECTION).doc(`${captureGroup}_${i}`);
    batch.set(ref, {
      userId,
      timestampUTC: FieldValue.serverTimestamp(),
      storagePath,
      captureGroup,
      screenIndex: i,
      activityPercent: activityPercent ?? null,
      activityMethod,
    }, { merge: true });
    return ref.id;
  });
  await batch.commit();
  return ids;
}

/**
 * Legacy path: base64 PNGs in a JSON body, relayed through the function.
 * Kept for renderers loaded before the signed-URL upload shipped (rule 9c), and
 * as the fallback when a signed PUT fails. New code uploads direct to Storage
 * — see rule 9i.
 */
export async function saveScreenshots(
  userId: string,
  screens: string[],
  activityPercent?: number | null,
  activityMethod: ActivityMethod | null = null,
): Promise<{ ids: string[]; captureGroup: string }> {
  const now = new Date();
  const captureGroup = randomUUID();
  const bucket = adminStorage.bucket();

  const kept: Buffer[] = [];
  for (const base64 of screens) {
    if (!base64) continue;
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 0) kept.push(buffer);
  }
  if (kept.length === 0) return { ids: [], captureGroup };

  // Full-size images — thumbnails are generated asynchronously by the Cloud Function
  const storagePaths = await Promise.all(
    kept.map(async (buffer, i) => {
      const storagePath = screenshotPath(userId, now, captureGroup, i);
      await bucket.file(storagePath).save(buffer, { contentType: 'image/png' });
      return storagePath;
    }),
  );

  const ids = await writeScreenshotDocs(userId, captureGroup, storagePaths, activityPercent ?? null, activityMethod);
  return { ids, captureGroup };
}

export interface ScreenshotRow {
  id: string;
  timestampUTC: string;
  storagePath: string;
  thumbnailPath: string | null;
  captureGroup: string;
  screenIndex: number;
  activityPercent: number | null;
}

import { getDayBoundsUTCDates } from '@/lib/utils/timezone';

export async function getScreenshotsByDate(
  userId: string,
  date: string,
  timezone = 'UTC',
): Promise<ScreenshotRow[]> {
  const { start: dayStart, end: dayEnd } = getDayBoundsUTCDates(date, timezone);

  const snap = await adminDb
    .collection(COLLECTION)
    .where('userId', '==', userId)
    .where('timestampUTC', '>=', Timestamp.fromDate(dayStart))
    .where('timestampUTC', '<=', Timestamp.fromDate(dayEnd))
    .orderBy('timestampUTC', 'asc')
    .limit(500)
    .get();

  return snap.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      timestampUTC: data.timestampUTC?.toDate?.()?.toISOString() ?? '',
      storagePath: data.storagePath,
      thumbnailPath: data.thumbnailPath || '',
      captureGroup: data.captureGroup || doc.id,
      screenIndex: data.screenIndex ?? 0,
      activityPercent: data.activityPercent ?? null,
    };
  });
}

export async function getScreenshotUrl(storagePath: string): Promise<string> {
  if (!storagePath) return '';
  const bucket = adminStorage.bucket();
  const file = bucket.file(storagePath);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000,
  });
  return url;
}

export async function getScreenshotCountsByUsers(
  userIds: string[],
): Promise<Record<string, number>> {
  if (userIds.length === 0) return {};

  const counts: Record<string, number> = {};

  await Promise.all(
    userIds.map(async (uid) => {
      const snap = await adminDb
        .collection(COLLECTION)
        .where('userId', '==', uid)
        .count()
        .get();
      counts[uid] = snap.data().count;
    })
  );

  return counts;
}

export async function deleteScreenshotsByUsersAndDateRange(
  userIds: string[],
  startDate: string,
  endDate: string,
): Promise<number> {
  if (userIds.length === 0) return 0;

  const rangeStart = new Date(`${startDate}T00:00:00.000Z`);
  const rangeEnd = new Date(`${endDate}T23:59:59.999Z`);

  let totalDeleted = 0;

  await Promise.all(
    userIds.map(async (uid) => {
      const snap = await adminDb
        .collection(COLLECTION)
        .where('userId', '==', uid)
        .where('timestampUTC', '>=', Timestamp.fromDate(rangeStart))
        .where('timestampUTC', '<=', Timestamp.fromDate(rangeEnd))
        .get();

      if (snap.empty) return;

      const ids = snap.docs.map((d) => d.id);
      // No chunking here — deleteScreenshots chunks its own reads and hands the
      // deletes to a BulkWriter, which paces them itself.
      await deleteScreenshots(ids);
      totalDeleted += ids.length;
    })
  );

  return totalDeleted;
}

/** `getAll` takes a bounded argument list; read the docs back in slices. */
const READ_CHUNK = 300;

/** Concurrent Storage object deletes. Bounded so a large purge cannot fan out to thousands. */
const STORAGE_DELETE_CONCURRENCY = 20;

/**
 * Delete screenshot documents and their Storage objects.
 *
 * Uses a BulkWriter rather than a 500-op batch: this is a bulk delete over a
 * contiguous key range (`userId` + adjacent `timestampUTC`), which is exactly
 * the contention case Firestore's best practices warn about. BulkWriter ramps
 * its own throughput and retries individual failures, where one bad document
 * fails an entire batch.
 */
export async function deleteScreenshots(
  screenshotIds: string[],
): Promise<void> {
  if (screenshotIds.length === 0) return;

  const bucket = adminStorage.bucket();
  const writer = adminDb.bulkWriter();
  writer.onWriteError((err) => {
    if (err.failedAttempts < 3) return true;
    console.error(`[Screenshot] Failed to delete doc ${err.documentRef.path}:`, err.message);
    return false;
  });

  const storagePaths: string[] = [];

  for (let i = 0; i < screenshotIds.length; i += READ_CHUNK) {
    const docRefs = screenshotIds
      .slice(i, i + READ_CHUNK)
      .map(id => adminDb.collection(COLLECTION).doc(id));

    // Batch-read the slice in a single round-trip instead of N sequential reads
    const snaps = await adminDb.getAll(...docRefs);

    for (const doc of snaps) {
      if (!doc.exists) continue;
      const data = doc.data();
      if (data?.storagePath) storagePaths.push(data.storagePath);
      if (data?.thumbnailPath) storagePaths.push(data.thumbnailPath);
      void writer.delete(doc.ref);
    }
  }

  // Storage deletes run alongside the Firestore ones, bounded rather than
  // fanned out across every object at once.
  let cursor = 0;
  const storageWorker = async () => {
    while (cursor < storagePaths.length) {
      const path = storagePaths[cursor++];
      await bucket.file(path).delete().catch(err => {
        console.error(`[Screenshot] Failed to delete storage file ${path}:`, err);
      });
    }
  };

  await Promise.all([
    writer.close(),
    ...Array.from(
      { length: Math.min(STORAGE_DELETE_CONCURRENCY, storagePaths.length) },
      storageWorker,
    ),
  ]);
}
