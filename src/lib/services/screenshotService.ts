import { adminDb, adminStorage } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

const COLLECTION = 'screenshots';
const THUMBNAIL_WIDTH = 300;
const THUMBNAIL_HEIGHT = 169; // ~16:9

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

    // Full-size image
    const storagePath = `screenshots/${userId}/${dateStr}/${timestamp}_${i}.png`;
    const file = bucket.file(storagePath);
    await file.save(buffer, { contentType: 'image/png' });

    // Generate thumbnail
    const thumbBuffer = await sharp(buffer)
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'cover' })
      .png({ quality: 70 })
      .toBuffer();

    const thumbPath = `screenshots/${userId}/${dateStr}/${timestamp}_${i}_thumb.png`;
    const thumbFile = bucket.file(thumbPath);
    await thumbFile.save(thumbBuffer, { contentType: 'image/png' });

    const docRef = await adminDb.collection(COLLECTION).add({
      userId,
      timestampUTC: FieldValue.serverTimestamp(),
      storagePath,
      thumbnailPath: thumbPath,
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
  thumbnailPath: string;
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
  const bucket = adminStorage.bucket();
  const batch = adminDb.batch();

  for (const id of screenshotIds) {
    const docRef = adminDb.collection(COLLECTION).doc(id);
    const doc = await docRef.get();
    if (doc.exists) {
      const data = doc.data();
      const storagePath = data?.storagePath;
      const thumbnailPath = data?.thumbnailPath;
      if (storagePath) {
        await bucket.file(storagePath).delete().catch(err => {
          console.error(`[Screenshot] Failed to delete storage file ${storagePath}:`, err);
        });
      }
      if (thumbnailPath) {
        await bucket.file(thumbnailPath).delete().catch(err => {
          console.error(`[Screenshot] Failed to delete thumbnail ${thumbnailPath}:`, err);
        });
      }
      batch.delete(docRef);
    }
  }

  await batch.commit();
}
