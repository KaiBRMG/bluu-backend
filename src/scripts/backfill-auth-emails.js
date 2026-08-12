'use strict';
// Run from repo root: cd src && node scripts/backfill-auth-emails.js
// Add --dry-run to preview without writing anything.
//
// Populates the `auth-emails` index — doc id = normalised email, body = { uid,
// email } — from every existing `users` doc.
//
// WHY THIS EXISTS
// Since the personal-email migration, login is an allowlist check: Google says
// who you are, and `auth-emails` says whether you may come in and as whom
// (src/app/api/auth/exchange-code/route.ts). Existing users pre-date the index,
// so without this backfill every one of them falls through to the slower
// `workEmail ==` query path — which cannot match a Gmail alias and heals the
// index only one user at a time, on their next login.
//
// Re-running is safe and idempotent.
//
// It also REPORTS two conditions that are security-relevant now that the email
// is the authorisation key, and which the app has never enforced:
//   • duplicate emails  — two users docs sharing one address. Whoever wins the
//     index owns the login; the other user silently cannot sign in. Must be
//     merged/deleted by hand — this script refuses to guess.
//   • missing/unparseable emails — a doc nobody can ever log in as.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── .env.local ───────────────────────────────────────────────────────────────
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
const db = admin.firestore();

// Mirror of normalizeEmail() in src/lib/authEmail.ts. Kept in sync by hand
// because this script is plain CJS and cannot import the TS module.
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
function normalizeEmail(email) {
  if (!email) return '';
  const trimmed = String(email).trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return '';
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    const plus = local.indexOf('+');
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replace(/\./g, '');
    if (local === '') return '';
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

async function main() {
  console.log(DRY_RUN ? '── DRY RUN — nothing will be written ──\n' : '── Backfilling auth-emails ──\n');

  const snap = await db.collection('users').get();
  console.log(`Read ${snap.size} user docs.\n`);

  /** normalisedEmail → [{ uid, email, name, isArchived }] */
  const byKey = new Map();
  const unusable = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const email = data.workEmail;
    const key = normalizeEmail(email);
    const name = data.displayName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || doc.id;

    if (!key) {
      unusable.push({ uid: doc.id, email: email ?? '(none)', name });
      continue;
    }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ uid: doc.id, email, name, isArchived: data.isArchived === true });
  }

  // ─── Report problems before writing anything ──────────────────────────────
  const duplicates = [...byKey.entries()].filter(([, rows]) => rows.length > 1);

  if (unusable.length > 0) {
    console.log(`── Users with no usable login email (${unusable.length}) ─────────────`);
    for (const u of unusable) console.log(`  ${u.name}  (${u.uid})  workEmail=${u.email}`);
    console.log('  → These users cannot sign in. Set a valid email in the Employee Registry.\n');
  }

  if (duplicates.length > 0) {
    console.log(`── DUPLICATE emails (${duplicates.length}) — NOT indexed ───────────────`);
    for (const [key, rows] of duplicates) {
      console.log(`  ${key}`);
      for (const r of rows) {
        console.log(`      ${r.name}  (${r.uid})${r.isArchived ? '  [archived]' : ''}`);
      }
    }
    console.log('  → Two docs share one login address. Merge or delete the stale one,');
    console.log('    then re-run. Skipped here rather than guessing which uid wins.\n');
  }

  // ─── Write ────────────────────────────────────────────────────────────────
  const writable = [...byKey.entries()].filter(([, rows]) => rows.length === 1);
  let written = 0;

  if (!DRY_RUN) {
    for (let i = 0; i < writable.length; i += 500) {
      const batch = db.batch();
      for (const [key, [row]] of writable.slice(i, i + 500)) {
        batch.set(db.collection('auth-emails').doc(key), {
          uid: row.uid,
          email: row.email,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      written += Math.min(500, writable.length - i);
    }
  }

  console.log('── Summary ────────────────────────────────────────────────────');
  console.log(`  indexed:    ${DRY_RUN ? `${writable.length} (would be)` : written}`);
  console.log(`  duplicates: ${duplicates.length} (skipped — fix by hand)`);
  console.log(`  unusable:   ${unusable.length}`);
  console.log(
    duplicates.length > 0 || unusable.length > 0
      ? '\n  Resolve the entries above, then re-run.'
      : '\n  Clean — every user has a unique, usable login email.',
  );
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
