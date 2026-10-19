/**
 * One-off backfill: stamp `approvedAt` on disputes approved before the field
 * existed, so they appear in CA Admin → Sales' "Moved by dispute" feed.
 *
 * Since 2026-10-19 every approval writes `approvedAt` (+ `approvedBy`,
 * `approvedVia`), and the feed orders on it. An older approved dispute has no
 * such field, so a query ordered on it never returns that dispute. Its
 * `resolvedAt` is when it was approved — that is what this copies across.
 * `approvedBy`/`approvedVia` are left absent: who ruled was never recorded, and
 * guessing would put a name on a decision that person may not have made. The
 * feed reads an absent `approvedVia` as "approved" with no name.
 *
 * Only the last 14 days matter to the feed, but the whole set is stamped so a
 * future, longer window needs no second run. Disputes approved before
 * `resolvedAt` existed have no date to copy and are skipped (and counted).
 *
 * Usage (from repo root):
 *   node src/scripts/backfill-dispute-approved-at.js            # dry run — reports only
 *   node src/scripts/backfill-dispute-approved-at.js --write    # writes
 *
 * Safe to re-run: a dispute that already has `approvedAt` is never touched.
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
const WRITE = process.argv.includes('--write');

async function main() {
  // Field-masked: the decision needs three fields, not the claimed-sale snapshots.
  const snap = await db
    .collection('disputes')
    .where('AdminApproval', '==', 'Approved')
    .select('approvedAt', 'resolvedAt')
    .get();

  let already = 0;
  let noDate = 0;
  const todo = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.approvedAt) already += 1;
    else if (!data.resolvedAt) noDate += 1;
    else todo.push({ ref: doc.ref, at: data.resolvedAt });
  }

  console.log(`Approved disputes: ${snap.size}`);
  console.log(`  already stamped:        ${already}`);
  console.log(`  no resolvedAt to copy:  ${noDate}`);
  console.log(`  to stamp:               ${todo.length}`);

  if (!WRITE) {
    console.log('\nDry run — nothing written. Re-run with --write to apply.');
    return;
  }

  const writer = db.bulkWriter();
  for (const { ref, at } of todo) writer.update(ref, { approvedAt: at });
  await writer.close();
  console.log(`\nStamped ${todo.length} disputes.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
