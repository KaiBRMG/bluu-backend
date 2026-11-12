#!/usr/bin/env node
/**
 * Fan registry migration: `buddyx-fan-names` → `fans`, same doc ids and fields
 * (onlymonster-migration.md §8).
 *
 *   cd src && node scripts/migrate-fan-registry.js --copy             # copy every doc (bulkWriter)
 *   cd src && node scripts/migrate-fan-registry.js --verify           # counts + per-doc hashes must match
 *   cd src && node scripts/migrate-fan-registry.js --delta --since 2026-11-20T10:00:00Z
 *                                                                     # after the deploy: docs updated since
 *
 * Then archive the old collection with scripts/archive-collection.js (plan §9.3).
 * Never deletes anything. `--copy` refuses if `fans` already has docs (use --delta).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
const FROM = 'buddyx-fan-names';
const TO = 'fans';
const arg = n => process.argv.includes(`--${n}`);
const opt = n => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function canonical(v) {
  if (v && typeof v.toMillis === 'function') return `ts:${v.toMillis()}`;
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${k}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const hash = d => crypto.createHash('sha256').update(canonical(d.data())).digest('hex');

async function all(col) {
  const out = new Map();
  let last;
  for (;;) {
    let q = db.collection(col).orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) out.set(d.id, d);
    if (snap.size < 1000) return out;
    last = snap.docs[snap.docs.length - 1];
  }
}

(async () => {
  if (arg('copy')) {
    const existing = await db.collection(TO).limit(1).get();
    if (!existing.empty) throw new Error(`${TO} already has documents; use --delta instead of --copy.`);
    const src = await all(FROM);
    const writer = db.bulkWriter();
    for (const [id, d] of src) writer.set(db.collection(TO).doc(id), d.data());
    await writer.close();
    console.log(`\n  ✓ copied ${src.size} docs ${FROM} → ${TO}. Started at ${new Date().toISOString()} — keep this for --delta.\n`);
  } else if (arg('verify')) {
    const [a, b] = await Promise.all([all(FROM), all(TO)]);
    let missing = 0;
    let differ = 0;
    for (const [id, d] of a) {
      const t = b.get(id);
      if (!t) missing += 1;
      else if (hash(d) !== hash(t)) differ += 1;
    }
    const ok = missing === 0 && differ === 0 && a.size === b.size;
    console.log(`\n  ${ok ? '✓' : '✗'} ${FROM}: ${a.size}   ${TO}: ${b.size}   missing in ${TO}: ${missing}   differing: ${differ}\n`);
    process.exit(ok ? 0 : 2);
  } else if (arg('delta')) {
    const since = Date.parse(opt('since') ?? '');
    if (!Number.isFinite(since)) throw new Error('--delta needs --since <ISO instant of the --copy run>');
    const src = await all(FROM);
    const writer = db.bulkWriter();
    let n = 0;
    for (const [id, d] of src) {
      const at = d.get('updatedAt')?.toMillis?.() ?? d.updateTime?.toMillis?.() ?? 0;
      if (at < since) continue;
      writer.set(db.collection(TO).doc(id), d.data(), { merge: true });
      n += 1;
    }
    await writer.close();
    console.log(`\n  ✓ delta: ${n} docs updated since ${new Date(since).toISOString()} copied to ${TO}.\n`);
  } else {
    console.log('Use --copy, --verify or --delta --since <ISO>.');
  }
})().catch(err => {
  console.error(`\n  ✗ ${err.message}\n`);
  process.exit(1);
});
