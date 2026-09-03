'use strict';
// Run from the repo root:  cd src && node scripts/fix-creator-menu-buttons.js
//   --dry-run   list who would be updated, change nothing
//
// Re-points every connected creator's Telegram chat menu button at
// `/creator/dashboard`.
//
// WHY THIS EXISTS
// The button used to be set to `/creator`, which server-redirects to
// `/creator/dashboard`. Telegram launches a Mini App with its signed `initData`
// in a URL *fragment*, and in-app webviews do not reliably re-attach a fragment
// across a redirect — so the portal opened with no launch payload and showed
// "Open in Telegram" to a creator who was correctly linked.
//
// The webhook now sets the correct URL at link time, so only creators connected
// BEFORE that fix need this. Safe and idempotent: re-running just re-sets the
// same button.

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

// Mirrors src/lib/publicOrigin.ts. Kept in sync by hand — this script is plain
// CJS and cannot import the TS module.
const PUBLIC_APP_ORIGIN = 'https://bluu-backend.vercel.app';
const MENU_URL = `${PUBLIC_APP_ORIGIN}/creator/dashboard`;

async function setMenuButton(token, chatId) {
  const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      menu_button: {
        type: 'web_app',
        text: 'Creator Portal',
        web_app: { url: MENU_URL },
      },
    }),
  });
  return res.json();
}

async function main() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set (src/.env.local).');
    process.exit(1);
  }

  const snapshot = await db.collection('creators').get();
  const connected = snapshot.docs
    .map((doc) => ({ uid: doc.id, ...doc.data() }))
    .filter((c) => c.telegram && c.telegram.chatId);

  if (connected.length === 0) {
    console.log('No connected creators.');
    return;
  }

  console.log(`Menu button → ${MENU_URL}\n`);

  if (DRY_RUN) {
    for (const c of connected) console.log(`  would update  ${c.stageName || c.uid}`);
    console.log(`\n${connected.length} creator(s). Re-run without --dry-run to apply.`);
    return;
  }

  let ok = 0;
  for (const c of connected) {
    const result = await setMenuButton(token, c.telegram.chatId);
    if (result.ok) {
      ok += 1;
      console.log(`  ✓ ${c.stageName || c.uid}`);
    } else {
      // Most likely cause: the Mini App domain is not registered for the bot in
      // BotFather, which Telegram refuses a web_app URL for.
      console.log(`  ✗ ${c.stageName || c.uid}  — ${result.description || 'unknown error'}`);
    }
  }
  console.log(`\n${ok}/${connected.length} updated.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
