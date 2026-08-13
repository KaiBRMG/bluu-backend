'use strict';
// Run from the app root: cd src && node scripts/backfill-smm-link-normalization.js
// Add --dry-run to preview every change without writing anything.
//
// ONE-TIME MIGRATION. `normalizePostLink` changed from "the pasted URL, lightly
// cleaned" to "the tweet's status id" (x.com/i/status/<id>). The old form kept
// whatever the SMM happened to paste, so these three stored fields disagree
// with each other AND with what the app now computes:
//
//   twitterx-content-schedule/{accountId}/posts/{postId}
//       postLink       → postLinkNormalized
//       originalLink   → originalLinkNormalized
//   twitterx-bonus/{roundId}/submissions/{id}
//       postLink       → postLinkNormalized
//       originalLink   → originalLinkNormalized
//
// Until this has run, every equality lookup built on those fields (duplicate
// detection, the viral-copy eligibility check and its report) silently misses
// pre-existing rows. Run it immediately after deploying the code change.
//
// Idempotent: a doc whose stored values already match the recomputed ones is
// skipped, so re-running is free and safe.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let db;
function initFirebase() {
  const envPath = path.join(__dirname, '../.env.local');
  const envLines = fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of envLines) {
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1);
      if (key) process.env[key] = val;
    }
  }
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
  db = admin.firestore();
}

const SMM_POSTS_SUB = 'posts';
const SMM_SUBMISSIONS_SUB = 'submissions';
const BATCH_SIZE = 400;
const dryRun = process.argv.includes('--dry-run');

// Mirrors normalizePostLink in src/lib/smm/linkUtils.ts.
function normalizePostLink(url) {
  let link = (url || '').trim();
  if (!link) return '';
  link = link.split('#')[0].split('?')[0];

  const statusId = (link.match(/\/status(?:es)?\/(\d+)/i) || [])[1];
  if (statusId) return `x.com/i/status/${statusId}`;

  link = link.replace(/\/(photo|video)\/\d+\/?$/i, '');
  link = link.replace(/\/+$/, '');
  link = link.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const parts = link.split('/');
  parts[0] = parts[0].toLowerCase().replace(/^twitter\.com$/, 'x.com');
  return parts.join('/');
}

async function backfill(collectionId, label) {
  const snap = await db.collectionGroup(collectionId)
    .select('postLink', 'postLinkNormalized', 'originalLink', 'originalLinkNormalized')
    .get();

  let batch = db.batch();
  let pending = 0;
  let changed = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const updates = {};

    // A residual submission deliberately carries empty normalized fields so it
    // stays out of duplicate checks — recomputing from its (also empty) links
    // preserves that, but only touch a field the doc actually has.
    if ('postLinkNormalized' in d) {
      const next = normalizePostLink(d.postLink);
      if (next !== d.postLinkNormalized) updates.postLinkNormalized = next;
    }
    if ('originalLinkNormalized' in d) {
      const next = normalizePostLink(d.originalLink);
      if (next !== d.originalLinkNormalized) updates.originalLinkNormalized = next;
    }
    if (Object.keys(updates).length === 0) continue;

    changed++;
    if (dryRun) {
      console.log(`  ${doc.ref.path}`);
      for (const [k, v] of Object.entries(updates)) {
        console.log(`    ${k}: ${JSON.stringify(d[k])} → ${JSON.stringify(v)}`);
      }
      continue;
    }

    batch.update(doc.ref, updates);
    if (++pending >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (!dryRun && pending > 0) await batch.commit();
  console.log(`${label}: ${changed} of ${snap.size} doc(s) ${dryRun ? 'would be' : ''} updated.`);
}

async function main() {
  initFirebase();
  console.log(dryRun ? '── DRY RUN — nothing will be written ──' : '── Writing ──');
  await backfill(SMM_POSTS_SUB, 'Content schedule posts');
  await backfill(SMM_SUBMISSIONS_SUB, 'Bonus submissions');
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
