/**
 * One-off backfill: for all campaign-tracking entries where createdBy is empty
 * and createdTime is before 2026-01-01, set amountPaid = totalAmount.
 *
 * Usage (from repo root):
 *   node src/scripts/backfill-amount-paid.js
 *
 * Requires FIREBASE_SERVICE_ACCOUNT in environment (or in src/.env.local).
 */

const path = require('path');
const fs = require('fs');

// Load src/.env.local if present
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT env var is required.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});

const db = admin.firestore();
const CUTOFF = new Date('2026-01-01T00:00:00.000Z');

async function run() {
  const snapshot = await db.collection('campaign-tracking').get();

  let batch = db.batch();
  let batchCount = 0;
  let updateCount = 0;
  let skippedCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    const createdByEmpty = !data.createdBy;

    let createdDate = null;
    if (data.createdTime && typeof data.createdTime.toDate === 'function') {
      createdDate = data.createdTime.toDate();
    } else if (data.createdTime) {
      createdDate = new Date(data.createdTime);
    }

    const beforeCutoff = createdDate && createdDate < CUTOFF;

    if (!createdByEmpty || !beforeCutoff) {
      skippedCount++;
      continue;
    }

    console.log(
      `Updating ${doc.id}: amountPaid ${data.amountPaid} → ${data.totalAmount}` +
      ` (createdTime: ${createdDate?.toISOString()}, createdBy: "${data.createdBy ?? ''}")`
    );

    batch.update(doc.ref, { amountPaid: data.totalAmount });
    updateCount++;
    batchCount++;

    // Firestore batches are limited to 500 operations
    if (batchCount === 500) {
      await batch.commit();
      console.log(`Committed batch of 500.`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`\nDone. Updated: ${updateCount}, Skipped: ${skippedCount}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
