const admin = require('firebase-admin');
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const sharp = require('sharp');

admin.initializeApp();

const STORAGE_BUCKET = 'bluu-backend.firebasestorage.app';
const THUMBNAIL_WIDTH = 300;
const THUMBNAIL_HEIGHT = 169;

/**
 * Thumbnail Generator — triggers on every new file written to Storage.
 *
 * When a full-size screenshot is saved (path: screenshots/{userId}/{date}/{file}.png,
 * does NOT end with _thumb.png), generates a 300x169 thumbnail, saves it alongside
 * the original, and updates the Firestore screenshots document with the thumbnailPath.
 */
exports.generateThumbnail = onObjectFinalized({ bucket: STORAGE_BUCKET }, async (event) => {
  const filePath = event.data.name;
  if (!filePath) return;
  if (!filePath.startsWith('screenshots/')) return;
  if (filePath.endsWith('_thumb.png')) return;

  const thumbPath = filePath.replace(/\.png$/, '_thumb.png');

  try {
    const bucket = admin.storage().bucket(STORAGE_BUCKET);

    const [buffer] = await bucket.file(filePath).download();

    const thumbBuffer = await sharp(buffer)
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'cover' })
      .png({ quality: 70 })
      .toBuffer();

    await bucket.file(thumbPath).save(thumbBuffer, { contentType: 'image/png' });

    const snap = await admin.firestore()
      .collection('screenshots')
      .where('storagePath', '==', filePath)
      .limit(1)
      .get();

    if (!snap.empty) {
      await snap.docs[0].ref.update({ thumbnailPath: thumbPath });
    }
  } catch (err) {
    console.error(`[generateThumbnail] Failed for ${filePath}:`, err);
  }
});


/**
 * Stale session cleanup — runs once per day at 02:00 UTC.
 *
 * Finds active_sessions documents that have not had a heartbeat in over 6 hours
 * and have not been explicitly clocked out. This catches:
 *   - Sessions paused or left on break before end-of-day (no heartbeat while
 *     paused, so lastUpdated freezes at the pause timestamp)
 *   - Devices that crashed and were never reopened
 *
 * 6 hours means any session quiet since before 8:00 PM UTC is caught at 02:00.
 * An actively working session at 02:00 UTC will have had a heartbeat within the
 * last 15 minutes and is never affected.
 *
 * For each stale session:
 *   1. Writes a time_entries ledger document with status:'interrupted' and
 *      didNotClockOut:true. The eventLog is left empty — the client will
 *      upload its local buffer the next time the app opens, and upload-log
 *      will merge the log into this document.
 *   2. Deletes the active_sessions document.
 *
 * If the client opens the app before this function runs (i.e. the session is
 * between 15 min and 6 h stale), the startup hydration logic handles it via
 * the /upload-log route instead.
 */
exports.cleanupStaleSessions = onSchedule({ schedule: '0 2 * * *', timeZone: 'UTC' }, async () => {
  const STALE_HOURS = 6;
  const cutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000),
  );

  const snap = await admin.firestore()
    .collection('active_sessions')
    .where('userClockOut', '==', false)
    .where('lastUpdated', '<', cutoff)
    .get();

  if (snap.empty) {
    console.log('[cleanupStaleSessions] No stale sessions found.');
    return;
  }

  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const batch = db.batch();

  for (const doc of snap.docs) {
    const data = doc.data();
    const sessionId = data.sessionId;

    if (!sessionId) {
      // Malformed document — just delete it
      batch.delete(doc.ref);
      continue;
    }

    // Use lastUpdated as the effective end time (last known heartbeat)
    const endTime = data.lastUpdated || now;

    const ledgerRef = db.collection('time_entries').doc(sessionId);
    batch.set(ledgerRef, {
      sessionId,
      userId:               data.userId,
      startTime:            data.startTime,
      endTime,
      // Aggregates are unknown without the event log — set to 0 until client uploads
      workingSeconds:       0,
      idleSeconds:          0,
      breakSeconds:         0,
      pauseSeconds:         0,
      didNotClockOut:       true,
      logUploadedAt:        null,  // client will fill this in via /upload-log
      eventLog:             [],
      status:               'interrupted',
      isManual:             false,
      modifications:        [],
      originalData:         { workingSeconds: 0, idleSeconds: 0, breakSeconds: 0, pauseSeconds: 0 },
      includeIdleTime:      false, // unknown without user doc; client upload will not update this
      timezone:             'UTC',
      createdAt:            now,
    });

    batch.delete(doc.ref);
  }

  await batch.commit();
  console.log(`[cleanupStaleSessions] Cleaned up ${snap.size} stale session(s).`);
});
