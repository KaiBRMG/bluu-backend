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
// Page IDs that exist in the app — must be kept in sync with src/lib/definitions.ts.
const KNOWN_PAGE_IDS = [
  'ca-admin', 'ca-dashboard', 'ca-shifts', 'ca-disputes',
  'ca-custom-requests', 'ca-campaigns',
  'user-management', 'sharing', 'shift-management',
  'admin-notifications', 'admin-creator-management',
  'creators-custom-requests', 'creators-content-planning',
  'time-tracking', 'apps-password-manager',
];

/**
 * Resolves which page IDs a user should have access to.
 * Mirrors src/lib/services/permissionResolver.ts — resolveAccessiblePages.
 *
 * @param {Map<string, {groups?: Record<string,boolean>, users?: Record<string,boolean>}>} permMap
 * @param {string} uid
 * @param {string[]} userGroups
 * @returns {string[]}
 */
function resolvePageIds(permMap, uid, userGroups) {
  const accessible = [];
  for (const pageId of KNOWN_PAGE_IDS) {
    const perm = permMap.get(pageId);
    if (!perm) continue;
    if (perm.users?.[uid]) { accessible.push(pageId); continue; }
    for (const g of userGroups) {
      if (perm.groups?.[g]) { accessible.push(pageId); break; }
    }
  }
  return accessible;
}

/**
 * Page-permissions sync — runs once per day at 03:00 UTC.
 *
 * Iterates every document in the users collection and compares its
 * permittedPageIds against what the page-permissions collection actually
 * grants (based on the user's groups and any direct-user grants).
 *
 * Any user whose permittedPageIds is missing, stale, or contains pages
 * they should no longer have access to is corrected in a single batch write.
 * permissionsVersion is incremented so the client-side cache invalidates
 * immediately on the next onSnapshot tick.
 *
 * This acts as a daily safety net that catches drift caused by:
 *   - Bugs in the cascade logic (e.g. removed groups not recomputed)
 *   - Out-of-band Firestore writes (console edits, migration scripts)
 *   - Group membership changes that didn't trigger a recompute
 */
exports.syncPagePermissions = onSchedule({ schedule: '0 3 * * *', timeZone: 'UTC' }, async () => {
  const db = admin.firestore();

  const [usersSnap, permSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('page-permissions').get(),
  ]);

  // Build a pageId → permission doc map
  const permMap = new Map();
  for (const doc of permSnap.docs) {
    permMap.set(doc.id, doc.data());
  }

  // Warn about pages with no permission doc (missing seed)
  for (const pageId of KNOWN_PAGE_IDS) {
    if (!permMap.has(pageId)) {
      console.warn(`[syncPagePermissions] No page-permissions doc for page: ${pageId}`);
    }
  }

  const batch = db.batch();
  let correctedCount = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    const groups = Array.isArray(data.groups) ? data.groups : [];
    const actual = Array.isArray(data.permittedPageIds) ? data.permittedPageIds : null;

    const expected = resolvePageIds(permMap, uid, groups);

    // Fast equality check using sorted join — avoids Set construction for matching docs
    const actualSorted   = actual ? [...actual].sort().join(',') : null;
    const expectedSorted = [...expected].sort().join(',');

    if (actualSorted === expectedSorted) continue;

    const actualSet   = new Set(actual ?? []);
    const expectedSet = new Set(expected);
    const missing = expected.filter(id => !actualSet.has(id));
    const extra   = (actual ?? []).filter(id => !expectedSet.has(id));

    console.log(`[syncPagePermissions] Correcting user ${uid} (${data.displayName ?? 'unknown'})`);
    if (missing.length) console.log(`  + adding  : ${missing.join(', ')}`);
    if (extra.length)   console.log(`  - removing: ${extra.join(', ')}`);

    batch.update(db.collection('users').doc(uid), {
      permittedPageIds: expected,
      permissionsVersion: admin.firestore.FieldValue.increment(1),
    });
    correctedCount++;
  }

  if (correctedCount === 0) {
    console.log('[syncPagePermissions] All users are in sync. No corrections needed.');
    return;
  }

  await batch.commit();
  console.log(`[syncPagePermissions] Corrected ${correctedCount} user(s).`);
});


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
      enableIdleTimeout:    true,  // unknown without user doc; default to enabled
      timezone:             'UTC',
      createdAt:            now,
    });

    batch.delete(doc.ref);
  }

  await batch.commit();
  console.log(`[cleanupStaleSessions] Cleaned up ${snap.size} stale session(s).`);
});
