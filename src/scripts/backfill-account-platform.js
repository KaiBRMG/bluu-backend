#!/usr/bin/env node
/**
 * Set `platform` on every creator and sub-account that does not have one yet.
 *
 *   cd src && node scripts/backfill-account-platform.js            # dry run: prints every decision
 *   cd src && node scripts/backfill-account-platform.js --write    # writes
 *
 * The field was introduced on 2026-11-11 (lib/creators/accountPlatform.ts) so the
 * OnlyMonster mapping can match OnlyFans accounts by handle without colliding with
 * a Fansly sub-account that reuses the same handle.
 *
 * Rules, decided with the user on 2026-11-11, never guessed:
 *   - creators: `onlyfans`, except the ids in FANSLY_CREATORS (Leo).
 *   - sub-accounts: from the label — "Fansly" → fansly, "JFF" / "JustForFans" →
 *     justforfans. Any other label is LEFT UNSET and listed, for an admin to choose
 *     in Creator Management (an unset account is excluded from OnlyFans mapping).
 *
 * Only ever ADDS a missing field. A platform that is already set is never changed.
 */

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnvLocal();

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set in src/.env.local');
  process.exit(1);
}

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const WRITE = process.argv.includes('--write');

/** Creators that are not OnlyFans accounts. Leo (@TwinkLeo) is Fansly — user, 2026-11-11. */
const FANSLY_CREATORS = new Set(['6opbCP2Dc6R26RS2PYrBBJqHJZO2']);

function subPlatformFromLabel(label) {
  const l = String(label ?? '').trim().toLowerCase().replace(/[\s.]/g, '');
  if (l === 'fansly') return 'fansly';
  if (l === 'jff' || l === 'justforfans') return 'justforfans';
  return null;
}

(async () => {
  const [creators, subs] = await Promise.all([
    db.collection('creators').select('stageName', 'OFID', 'platform', 'isArchived').get(),
    db.collection('creator-subaccounts').select('stageName', 'label', 'OFID', 'platform').get(),
  ]);

  const writes = [];
  const unresolved = [];
  console.log(`\n  ${WRITE ? 'WRITING' : 'DRY RUN (add --write)'}\n`);

  for (const d of creators.docs) {
    if (d.get('platform')) {
      console.log(`  keep  creator ${d.get('stageName')} (${d.get('OFID')}) = ${d.get('platform')}`);
      continue;
    }
    const platform = FANSLY_CREATORS.has(d.id) ? 'fansly' : 'onlyfans';
    console.log(`  set   creator ${d.get('stageName')} (${d.get('OFID')})${d.get('isArchived') ? ' [archived]' : ''} → ${platform}`);
    writes.push({ ref: d.ref, platform });
  }
  for (const d of subs.docs) {
    if (d.get('platform')) {
      console.log(`  keep  sub     ${d.get('stageName')} (${d.get('OFID')}) = ${d.get('platform')}`);
      continue;
    }
    const platform = subPlatformFromLabel(d.get('label'));
    if (!platform) {
      unresolved.push(`${d.get('stageName')} (label "${d.get('label')}")`);
      console.log(`  ????  sub     ${d.get('stageName')} (label "${d.get('label')}") — left unset, choose in Creator Management`);
      continue;
    }
    console.log(`  set   sub     ${d.get('stageName')} (${d.get('OFID')}) → ${platform}`);
    writes.push({ ref: d.ref, platform });
  }

  console.log(`\n  ${writes.length} to set, ${unresolved.length} unresolved.`);
  if (!WRITE || writes.length === 0) return console.log('');

  const batch = db.batch();
  // `updatedAt` is left alone: this is a schema backfill, not an edit anyone made.
  for (const w of writes) batch.update(w.ref, { platform: w.platform });
  await batch.commit();
  console.log(`  ✓ wrote ${writes.length}.\n`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
