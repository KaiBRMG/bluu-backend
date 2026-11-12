#!/usr/bin/env node
/**
 * D24: copy BuddyX's Chatter Analytics activity days (27 Sep – 31 Oct 2026) into
 * `chatter-days`, labelled `source: 'buddyx-historical'`, before `buddyx-team-days`
 * is archived (onlymonster-migration.md §7, §9.3). OnlyMonster has member activity
 * only from 2026-11-01, so without this those five weeks would read "—".
 *
 *   cd src && node scripts/onlymonster-carry-buddyx-activity.js           # dry run
 *   cd src && node scripts/onlymonster-carry-buddyx-activity.js --write
 *
 * Copies BuddyX's breakdown rows verbatim (`breakdown`), so the Chatter Analytics
 * fold reads them exactly as before. Never overwrites an OnlyMonster day.
 * Idempotent: re-running rewrites the same docs.
 */
const fs = require('fs');
const path = require('path');
(function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
})();
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const WRITE = process.argv.includes('--write');
const FROM = '2026-09-27';
const BEFORE = '2026-11-01';

(async () => {
  const snap = await db.collection('buddyx-team-days').get();
  const days = snap.docs.filter(d => d.id >= FROM && d.id < BEFORE);
  const existing = await db.getAll(...days.map(d => db.collection('chatter-days').doc(d.id)));
  const writer = WRITE ? db.bulkWriter() : null;
  let copied = 0;
  let skipped = 0;
  days.forEach((d, i) => {
    if (existing[i].exists && existing[i].get('source') === 'onlymonster') {
      skipped += 1;
      return;
    }
    copied += 1;
    if (writer) {
      writer.set(db.collection('chatter-days').doc(d.id), {
        day: d.id,
        source: 'buddyx-historical',
        breakdown: d.get('breakdown') ?? [],
        rows: {},
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });
  if (writer) await writer.close();
  console.log(`\n  ${WRITE ? 'Copied' : 'Would copy'} ${copied} BuddyX day(s) ${FROM} … ${BEFORE} (exclusive) into chatter-days; ${skipped} skipped (OnlyMonster day).\n`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
