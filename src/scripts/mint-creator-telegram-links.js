'use strict';
// Run from the repo root:  cd src && node scripts/mint-creator-telegram-links.js
//
//   --dry-run          list creators and their connection state; mint nothing
//   --all              include creators who are ALREADY connected (re-issues,
//                      which revokes their existing link — see below)
//   --include-inactive include deactivated / archived creators
//   --uid <uid>        just this one creator
//
// Prints one connection link per creator, for you to send by hand. This is the
// bulk counterpart to the "Copy Telegram link" row action on
// /admin-portal/creator-management — same service, same tokens, same 7-day
// single-use rules; the page is for one creator, this is for onboarding the
// whole roster at once.
//
// ── Read this before running it ──────────────────────────────────────────────
//
// • **Minting revokes.** Each creator has at most one live invite
//   (`telegramLinkTokenHash` on their doc), and minting a new one deletes the
//   previous. So re-running this over creators you already sent links to
//   invalidates what you sent. That is why already-connected creators are
//   SKIPPED by default and `--all` is opt-in.
//
// • **The token is printed once and is not recoverable.** Only its SHA-256 is
//   stored. Lose the output and you mint again (revoking, per above).
//
// • **The output is credential material.** Each line is a one-time key to a
//   creator's portal account. Do not paste the whole block into a shared
//   channel; send each creator only their own line.
//
// Deliberately a script rather than a page: a screen that renders every live
// invite at once would be a standing list of account-binding credentials, and
// nobody needs to see anyone else's.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_CONNECTED = process.argv.includes('--all');
const INCLUDE_INACTIVE = process.argv.includes('--include-inactive');
const uidFlag = process.argv.indexOf('--uid');
const ONLY_UID = uidFlag === -1 ? null : process.argv[uidFlag + 1];

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

// Mirrors src/lib/telegramConfig.ts and telegramLinkService.ts. Kept in sync by
// hand because this script is plain CJS and cannot import the TS modules — if
// the bot username or the token shape changes there, change it here too.
const BOT_USERNAME = 'BluuRockBot';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function mintToken() {
  // 32 bytes → 43 base64url chars, inside Telegram's 64-char `start` limit.
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function main() {
  const snapshot = await db.collection('creators').get();

  const creators = snapshot.docs
    .map((doc) => ({ uid: doc.id, ...doc.data() }))
    .filter((c) => (ONLY_UID ? c.uid === ONLY_UID : true))
    .filter((c) => (INCLUDE_INACTIVE ? true : c.isActive !== false && c.isArchived !== true))
    .sort((a, b) => String(a.stageName || '').localeCompare(String(b.stageName || '')));

  if (creators.length === 0) {
    console.log('No creators matched.');
    return;
  }

  const skipped = [];
  const targets = [];
  for (const c of creators) {
    if (c.telegram && c.telegram.userId && !INCLUDE_CONNECTED) skipped.push(c);
    else targets.push(c);
  }

  if (skipped.length > 0) {
    console.log(`Already connected, skipped (${skipped.length}) — pass --all to re-issue:`);
    for (const c of skipped) {
      const handle = c.telegram.username ? `@${c.telegram.username}` : c.telegram.userId;
      console.log(`  ${c.stageName || c.uid}  ${handle}`);
    }
    console.log('');
  }

  if (targets.length === 0) {
    console.log('Nothing to mint.');
    return;
  }

  if (DRY_RUN) {
    console.log(`Would mint ${targets.length} link(s):`);
    for (const c of targets) {
      const reissue = c.telegram && c.telegram.userId ? '  (RE-ISSUE — revokes their current link)' : '';
      console.log(`  ${c.stageName || c.uid}${reissue}`);
    }
    console.log('\nRe-run without --dry-run to generate them.');
    return;
  }

  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const lines = [];

  for (const c of targets) {
    const token = mintToken();
    const tokenHash = hashToken(token);
    const previousHash = c.telegramLinkTokenHash;

    const batch = db.batch();
    if (typeof previousHash === 'string' && previousHash && previousHash !== tokenHash) {
      batch.delete(db.collection('telegram-links').doc(previousHash));
    }
    batch.set(db.collection('telegram-links').doc(tokenHash), {
      subjectKind: 'creator',
      subjectUid: c.uid,
      createdBy: 'script:mint-creator-telegram-links',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
      usedAt: null,
    });
    batch.update(db.collection('creators').doc(c.uid), {
      telegramLinkTokenHash: tokenHash,
      telegramLinkCreatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    lines.push({
      name: c.stageName || c.displayName || c.uid,
      email: c.userEmail || '',
      url: `https://t.me/${BOT_USERNAME}?start=${token}`,
    });
  }

  console.log('─'.repeat(72));
  console.log(`CREATOR CONNECTION LINKS — single use, expire ${expiresAt.toISOString().slice(0, 10)}`);
  console.log('Send each creator ONLY their own line.');
  console.log('─'.repeat(72));
  for (const l of lines) {
    console.log(`\n${l.name}${l.email ? `  <${l.email}>` : ''}\n  ${l.url}`);
  }
  console.log(`\n─ ${lines.length} link(s) generated ─`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
