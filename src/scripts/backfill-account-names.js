/**
 * Backfill: for every entry in the `twitterx-accounts` collection, derive the
 * username from `accountLink` and overwrite `accountName` with it.
 *
 * Username derivation — the handle is the first path segment after the host:
 *   https://x.com/_eugxne              → _eugxne
 *   https://x.com/_NoahTwink/media     → _NoahTwink   (trailing /media, /photo, etc. dropped)
 *   https://twitter.com/tymothyfire    → tymothyfire
 *
 * Usage (from repo root):
 *   node src/scripts/backfill-account-names.js            # writes changes
 *   node src/scripts/backfill-account-names.js --dry-run  # preview only, no writes
 *
 * Requires FIREBASE_SERVICE_ACCOUNT in environment (or in src/.env.local).
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── Load src/.env.local if present ─────────────────────────────────────────
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
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Extract the username (handle) from a twitter/x account link.
 * Returns null if no username can be derived.
 */
function extractUsername(rawLink) {
  if (!rawLink || typeof rawLink !== 'string') return null;

  let link = rawLink.trim();
  if (!link) return null;

  // Strip protocol and leading www.
  link = link.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

  // Must be an x.com or twitter.com host.
  const match = link.match(/^(?:x\.com|twitter\.com)\/(.+)$/i);
  if (!match) return null;

  // First path segment after the host is the handle; drop everything after
  // the next slash (e.g. /media, /photo, /with_replies) and any query/hash.
  let username = match[1].split(/[/?#]/)[0].trim();

  // Drop a leading '@' if the link somehow contains one.
  username = username.replace(/^@/, '');

  return username || null;
}

async function run() {
  console.log('Loading twitterx-accounts...');
  const snapshot = await db.collection('twitterx-accounts').get();
  console.log(`  ${snapshot.size} entries loaded\n`);

  let batch = db.batch();
  let batchCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  const skipped = []; // { id, accountName, accountLink, reason }
  const changes = []; // { id, from, to }

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const rawLink = data.accountLink;

    if (!rawLink) {
      skipped.push({ id: doc.id, accountName: data.accountName, accountLink: rawLink, reason: 'Missing accountLink' });
      continue;
    }

    const username = extractUsername(rawLink);
    if (!username) {
      skipped.push({ id: doc.id, accountName: data.accountName, accountLink: rawLink, reason: 'Could not derive username from accountLink' });
      continue;
    }

    if (data.accountName === username) {
      unchangedCount++;
      continue;
    }

    changes.push({ id: doc.id, from: data.accountName, to: username });

    if (!DRY_RUN) {
      batch.update(doc.ref, { accountName: username });
      batchCount++;

      // Firestore batches are limited to 500 operations.
      if (batchCount === 500) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
    updatedCount++;
  }

  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(DRY_RUN ? '  SUMMARY (dry run — no writes performed)' : '  SUMMARY');
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(`  Total entries               : ${snapshot.size}`);
  console.log(`  accountName ${DRY_RUN ? 'to update' : 'updated  '}       : ${updatedCount}`);
  console.log(`  Already correct (unchanged) : ${unchangedCount}`);
  console.log(`  Skipped                     : ${skipped.length}`);
  console.log('══════════════════════════════════════════════════════════════════════');

  if (changes.length > 0) {
    console.log(`\n── ${DRY_RUN ? 'Would update' : 'Updated'} (${changes.length}) ──────────────────────────────────────`);
    for (const c of changes) {
      console.log(`  [${c.id}] "${c.from ?? ''}" → "${c.to}"`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\n── Skipped (${skipped.length}) ──────────────────────────────────────────────`);
    for (const s of skipped) {
      console.log(`  [${s.id}] accountName="${s.accountName ?? ''}" accountLink="${s.accountLink ?? ''}"  —  ${s.reason}`);
    }
  }

  console.log('\nDone!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
