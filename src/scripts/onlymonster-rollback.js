#!/usr/bin/env node
/**
 * Phase 4 rollback: take the OnlyMonster pay rows (`ca-sales/om-*`) back out of pay
 * (onlymonster-migration.md §10, Phase 4 "Rollback").
 *
 *   cd src && node scripts/onlymonster-rollback.js                  # dry run: the full report
 *   cd src && node scripts/onlymonster-rollback.js --write          # soft-remove the clean rows
 *   cd src && node scripts/onlymonster-rollback.js --write --replay # also replay pay decisions onto bx-* rows
 *
 * Order of operations (the script checks the first itself):
 *   1. Switch pay writes off: CA Admin → Sales → OnlyMonster (salesWriteEnabled = false).
 *   2. Run this script: dry run, read the report, then --write.
 *   3. Return ONLYMONSTER_CUTOVER_AT to Infinity in salaryConstants.ts and deploy;
 *      BuddyX then owns and re-pulls those days on its next run.
 *
 * Rules, never relaxed:
 *   - Rows are SOFT-removed (`removedAt`). Nothing is ever hard-deleted. No bx-* or
 *     Infloww row is touched, except by --replay as below.
 *   - Nothing inside a month finalised for the row's holder is touched — a finalised
 *     month containing om-* rows is never rolled back (correct it forward as an override).
 *   - A row carrying a pay decision (a transfer, an open dispute, an assignmentLog) is
 *     NOT removed unless --replay finds exactly one matching bx-* row (same creator,
 *     kind, fan and gross; BuddyX instant within 120 s before OnlyFans') with no
 *     transfer of its own, and copies the decision onto it first. Anything else is
 *     listed for an admin and left as it is.
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

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set in src/.env.local');
  process.exit(1);
}
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const WRITE = process.argv.includes('--write');
const REPLAY = process.argv.includes('--replay');
const BX_WINDOW_MS = 120_000;
const cents = n => Math.round(Number(n) * 100);

(async () => {
  const config = await db.doc('onlymonster-meta/config').get();
  if (WRITE && config.get('salesWriteEnabled') === true) {
    console.error('\n  ✗ Pay writes are still ON. Switch salesWriteEnabled off first (CA Admin → Sales → OnlyMonster).\n');
    process.exit(1);
  }

  const snap = await db.collection('ca-sales').where('source', '==', 'onlymonster').get();
  const rows = snap.docs.filter(d => !d.get('removedAt'));
  console.log(`\n  ${WRITE ? 'WRITING' : 'DRY RUN'} — ${rows.length} live om-* rows\n`);

  const finalCache = new Map();
  const isFinal = async (uid, month) => {
    if (!uid) return false;
    const key = `${uid}_${month}`;
    if (!finalCache.has(key)) finalCache.set(key, (await db.collection('ca-salary-months').doc(key).get()).exists);
    return finalCache.get(key);
  };

  const clean = [];
  const decided = [];
  const frozen = [];
  for (const d of rows) {
    if (await isFinal(d.get('userId'), d.get('month'))) frozen.push(d);
    else if (d.get('transfer') || d.get('disputeId') || (d.get('assignmentLog') || []).length) decided.push(d);
    else clean.push(d);
  }
  const gross = list => list.reduce((s, d) => s + (Number(d.get('signedGross')) || 0), 0).toFixed(2);
  console.log(`  clean (soft-removable):          ${clean.length}  ($${gross(clean)})`);
  console.log(`  carrying a pay decision:         ${decided.length}  ($${gross(decided)})`);
  console.log(`  in a finalised month (left as is): ${frozen.length}  ($${gross(frozen)})`);

  // ── Replay plan for rows carrying a decision ──
  const replays = [];
  const stuck = [];
  for (const d of decided) {
    const at = d.get('occurredAt').toMillis();
    const q = await db
      .collection('ca-sales')
      .where('creatorId', '==', d.get('creatorId'))
      .where('kind', '==', d.get('kind'))
      .where('occurredAt', '>=', Timestamp.fromMillis(at - BX_WINDOW_MS))
      .where('occurredAt', '<=', Timestamp.fromMillis(at))
      .get();
    const hits = q.docs.filter(
      b => b.get('source') === 'buddyx' && !b.get('removedAt') && String(b.get('fanId')) === String(d.get('fanId')) && cents(b.get('grossRevenue')) === cents(d.get('grossRevenue')),
    );
    if (hits.length === 1 && !hits[0].get('transfer') && !hits[0].get('disputeId')) replays.push({ om: d, bx: hits[0] });
    else stuck.push({ om: d, reason: hits.length === 0 ? 'no bx-* match' : hits.length > 1 ? `${hits.length} bx-* matches` : 'the bx-* match already carries a decision' });
  }
  console.log(`\n  replayable onto a unique bx-* row: ${replays.length}`);
  for (const r of replays) console.log(`    ${r.om.id} → ${r.bx.id}  (holder ${r.om.get('userId')}${r.om.get('disputeId') ? `, dispute ${r.om.get('disputeId')}` : ''})`);
  console.log(`  needs an admin (left in place):    ${stuck.length}`);
  for (const s of stuck) console.log(`    ${s.om.id}  ${s.reason}`);

  if (!WRITE) {
    console.log('\n  Dry run only. Add --write to soft-remove the clean rows, and --replay to also replay the decisions above.\n');
    return;
  }

  const writer = db.bulkWriter();
  const now = FieldValue.serverTimestamp();
  for (const d of clean) writer.update(d.ref, { removedAt: now, rolledBackAt: now });
  if (REPLAY) {
    for (const { om, bx } of replays) {
      // The decision moves with the sale: the bx-* row takes the transfer, its log and the dispute lock.
      writer.update(bx.ref, {
        transfer: om.get('transfer') ?? null,
        userId: om.get('userId') ?? null,
        transferFromUserId: om.get('transferFromUserId') ?? null,
        assignmentLog: om.get('assignmentLog') ?? [],
        disputeId: om.get('disputeId') ?? null,
        replayedFromSaleId: om.id,
      });
      writer.update(om.ref, { removedAt: now, rolledBackAt: now, replayedToSaleId: bx.id });
    }
  }
  await writer.close();
  console.log(`\n  ✓ soft-removed ${clean.length}${REPLAY ? `, replayed ${replays.length}` : ''}. Now return ONLYMONSTER_CUTOVER_AT to Infinity and deploy.\n`);
  if (replays.some(r => r.om.get('disputeId'))) {
    console.log('  ⚠ Replayed rows carried open disputes: those dispute documents still name the om-* sale id. Re-point them by hand.\n');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
