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
  const ids: string[] = [];

  for (let i = 0; i < screens.length; i++) {
    const base64 = screens[i];
    if (!base64 || base64.length === 0) continue;

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) continue;

    // Full-size image — thumbnail is generated asynchronously by the Cloud Function
    const storagePath = `screenshots/${userId}/${dateStr}/${timestamp}_${i}.png`;
    const file = bucket.file(storagePath);
    await file.save(buffer, { contentType: 'image/png' });

    const docRef = await adminDb.collection(COLLECTION).add({
      userId,
      timestampUTC: FieldValue.serverTimestamp(),
      storagePath,
      thumbnailPath: null,
      captureGroup,
      screenIndex: i,
    });

    ids.push(docRef.id);
  }

  return ids;
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
