#!/usr/bin/env node
/**
 * One-off (2026-09-28): creates `page-permissions/creators-onboarding` as a copy
 * of `page-permissions/apps-model-submissions`, so everyone who reviews
 * applications also gets the new Creator Portal → Onboarding page on day one.
 *
 * Usage (run from src/):
 *   node scripts/seed-onboarding-permission.js          # dry run — prints what it would write
 *   node scripts/seed-onboarding-permission.js --write  # creates the doc
 *
 * Then resolve it onto users immediately with
 *   node scripts/repair-permissions.js --fix
 * or leave it to the nightly `syncPagePermissions` (03:00 UTC).
 *
 * Refuses to overwrite an existing `creators-onboarding` doc — once an admin
 * has edited it on the Sharing page, that is the source of truth.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadEnvLocal();
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT is not set and could not be read from .env.local');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

const SOURCE = 'apps-model-submissions';
const TARGET = 'creators-onboarding';

(async () => {
  const write = process.argv.includes('--write');
  const [source, target] = await db.getAll(
    db.collection('page-permissions').doc(SOURCE),
    db.collection('page-permissions').doc(TARGET),
  );

  if (target.exists) {
    console.log(`page-permissions/${TARGET} already exists — leaving it alone:`, target.data());
    return;
  }
  if (!source.exists) {
    console.error(`page-permissions/${SOURCE} does not exist — nothing to copy.`);
    process.exit(1);
  }

  const { groups = {}, users = {} } = source.data();
  const doc = { pageId: TARGET, groups, users };
  console.log(`${write ? 'Writing' : 'Would write'} page-permissions/${TARGET}:`, JSON.stringify(doc, null, 2));
  if (write) {
    await db.collection('page-permissions').doc(TARGET).set(doc);
    console.log('Done. Now run: node scripts/repair-permissions.js --fix');
  } else {
    console.log('Dry run. Re-run with --write to create it.');
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
