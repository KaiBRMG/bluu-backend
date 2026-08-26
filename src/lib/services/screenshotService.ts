import { adminDb, adminStorage } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';

const COLLECTION = 'screenshots';

export async function saveScreenshots(
  userId: string,
  screens: string[],
  activityPercent?: number | null,
): Promise<string[]> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timestamp = now.getTime();
  const captureGroup = randomUUID();

  const bucket = adminStorage.bucket();

  // Save all images to Storage in parallel, collecting (storagePath, docRef) pairs
  const saved: Array<{ storagePath: string; docRef: FirebaseFirestore.DocumentReference }> = [];

  await Promise.all(
    screens.map(async (base64, i) => {
      if (!base64 || base64.length === 0) return;
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length === 0) return;

      // Full-size image — thumbnail is generated asynchronously by the Cloud Function
      const storagePath = `screenshots/${userId}/${dateStr}/${timestamp}_${i}.png`;
      await bucket.file(storagePath).save(buffer, { contentType: 'image/png' });

      saved.push({ storagePath, docRef: adminDb.collection(COLLECTION).doc() });
    }),
  );

  if (saved.length === 0) return [];

  // Write all Firestore docs in a single batch (one round-trip instead of N)
  const batch = adminDb.batch();
  saved.forEach(({ storagePath, docRef }, i) => {
    batch.set(docRef, {
      userId,
      timestampUTC: FieldValue.serverTimestamp(),
      storagePath,
      thumbnailPath: null,
      captureGroup,
      screenIndex: i,
      activityPercent: activityPercent ?? null,
    });
  });
  await batch.commit();

  return saved.map(({ docRef }) => docRef.id);
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
