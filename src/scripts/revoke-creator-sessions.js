'use strict';
// Run from the repo root:  cd src && node scripts/revoke-creator-sessions.js
//   --dry-run   list who would be signed out, change nothing
//
// Signs out EVERY creator, everywhere, immediately.
//
// WHY THIS EXISTS
// Before the Telegram cutover, creators signed in with email/password and
// Firebase persisted a refresh token in their phone browser. Those sessions do
// not expire on their own — a creator who was signed in last month is still
// signed in. `revokeRefreshTokens` invalidates all of them at once.
//
// ── This is a flush, not the lock ────────────────────────────────────────────
// The actual enforcement is the `tg` claim: only /api/creator/telegram/session
// mints it, and `withCreatorAuth` plus the Firestore rules refuse anything
// without it. Those old sessions were already dead the moment that shipped.
//
// Revocation is still worth running, for one reason: without it those clients
// stay *signed in* and simply fail every request, which reads as a broken app
// rather than a signed-out one. This ends them cleanly.
//
// ── What it does NOT do ──────────────────────────────────────────────────────
// It does not touch passwords or disable accounts. A creator can sign in again
// the moment they use their Telegram link — which is the intended path, and the
// only one that produces a session that can reach anything.
//
// Safe to re-run. A creator who has since connected through Telegram is signed
// out too and simply reopens the Mini App, so prefer running it once, before
// you send the links out.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

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
const auth = admin.auth();

async function main() {
  const snapshot = await db.collection('creators').get();
  const creators = snapshot.docs
    .map((doc) => ({ uid: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.stageName || '').localeCompare(String(b.stageName || '')));

  if (creators.length === 0) {
    console.log('No creators.');
    return;
  }

  if (DRY_RUN) {
    console.log(`Would revoke refresh tokens for ${creators.length} creator(s):`);
    for (const c of creators) console.log(`  ${c.stageName || c.uid}`);
    console.log('\nRe-run without --dry-run to apply.');
    return;
  }

  let ok = 0;
  for (const c of creators) {
    try {
      await auth.revokeRefreshTokens(c.uid);
      ok += 1;
      console.log(`  ✓ ${c.stageName || c.uid}`);
    } catch (error) {
      // A creators doc with no Auth account is a pre-existing inconsistency, not
      // a failure of this script — report and carry on.
      const code = error && error.code ? error.code : 'unknown';
      console.log(`  ✗ ${c.stageName || c.uid}  — ${code}`);
    }
  }

  console.log(`\n${ok}/${creators.length} signed out.`);
  console.log('They regain access by using their Telegram link and opening the Mini App.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
