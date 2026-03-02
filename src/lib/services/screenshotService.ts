import { adminDb, adminStorage } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';

const COLLECTION = 'screenshots';

export async function saveScreenshots(
  userId: string,
  screens: string[],
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
}

export async function getScreenshotsByDate(
  userId: string,
  date: string,
): Promise<ScreenshotRow[]> {
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  const snap = await adminDb
    .collection(COLLECTION)
    .where('userId', '==', userId)
    .where('timestampUTC', '>=', Timestamp.fromDate(dayStart))
    .where('timestampUTC', '<=', Timestamp.fromDate(dayEnd))
    .orderBy('timestampUTC', 'asc')
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
      // deleteScreenshots uses getAll which supports up to 500 docs; chunk to be safe
      const CHUNK = 400;
      for (let i = 0; i < ids.length; i += CHUNK) {
        await deleteScreenshots(ids.slice(i, i + CHUNK));
      }
      totalDeleted += ids.length;
    })
  );

  return totalDeleted;
}

export async function deleteScreenshots(
  screenshotIds: string[],
): Promise<void> {
  if (screenshotIds.length === 0) return;

  const bucket = adminStorage.bucket();
  const docRefs = screenshotIds.map(id => adminDb.collection(COLLECTION).doc(id));

  // Batch-read all docs in a single round-trip instead of N sequential reads
  const snaps = await adminDb.getAll(...docRefs);

  const batch = adminDb.batch();
  await Promise.all(snaps.map(async (doc) => {
    if (!doc.exists) return;
    const data = doc.data();
    const storagePath = data?.storagePath;
    const thumbnailPath = data?.thumbnailPath;
    await Promise.all([
      storagePath
        ? bucket.file(storagePath).delete().catch(err => {
            console.error(`[Screenshot] Failed to delete storage file ${storagePath}:`, err);
          })
        : Promise.resolve(),
      thumbnailPath
        ? bucket.file(thumbnailPath).delete().catch(err => {
            console.error(`[Screenshot] Failed to delete thumbnail ${thumbnailPath}:`, err);
          })
        : Promise.resolve(),
    ]);
    batch.delete(doc.ref);
  }));

  await batch.commit();
}
