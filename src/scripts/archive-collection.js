#!/usr/bin/env node
/**
 * Export a Firestore collection to Cloud Storage, verify it, and (only on explicit
 * confirmation) delete it. onlymonster-migration.md invariants 5 and 6 / §9.3.
 *
 *   cd src && node scripts/archive-collection.js --collection buddyx-team-days            # export (dry: lists only)
 *   cd src && node scripts/archive-collection.js --collection buddyx-team-days --write     # export
 *   cd src && node scripts/archive-collection.js --collection buddyx-team-days --verify    # re-read the export, compare to live
 *   cd src && node scripts/archive-collection.js --collection buddyx-team-days --delete --confirm buddyx-team-days
 *
 *   # Invariant 6: a full pay backup before an irreversible step. Exports ca-sales, disputes,
 *   # shifts, leave_requests and every ca-salary-* collection under archive/backups/<label>/.
 *   cd src && node scripts/archive-collection.js --backup pre-cutover --write
 *   cd src && node scripts/archive-collection.js --backup pre-cutover --verify
 *
 * Why a script and not `gcloud firestore export`: the Cloud SDK is not installed on
 * these machines (same reason as set-storage-cors.js). The Admin SDK credential this
 * repo already uses is enough.
 *
 * Output per collection, under gs://<bucket>/<prefix>/<collection>/:
 *   <date>.ndjson.gz        one JSON doc per line: {"id": "...", "data": {...}}
 *   <date>.hashes.ndjson.gz one {"id","hash"} per line (sha256 of the canonical doc)
 *   <date>.manifest.json    { collection, date, count, dataSha256, hashesFile, ... }
 *
 * Firestore types are tagged so the file is lossless: Timestamp → {"__t":"ts","s","n"},
 * GeoPoint, DocumentReference, Bytes. Plain JSON would silently turn Timestamps into
 * objects and make a restore impossible.
 *
 * Safety:
 *   - Default is a DRY RUN (counts only). Export needs --write, mirroring the repo's
 *     dry-run/--write convention.
 *   - Delete needs --delete AND --confirm <exact collection name>, runs verify first and
 *     refuses on any drift, and NEVER deletes a pay collection (PROTECTED below).
 *   - Delete uses bulkWriter() over listDocuments() (rule 9) — flat collections only.
 *     A collection with subcollections is refused rather than orphaning them.
 *   - Exports are never overwritten: the object name carries the date, and an existing
 *     object makes the export refuse.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { StringDecoder } = require('string_decoder');

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

const fail = msg => {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
};

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = n => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

// Pay and schedule data. These are backed up, never deleted by this script.
const PROTECTED = new Set(['ca-sales', 'disputes', 'ca-sales-imports', 'shifts', 'leave_requests', 'users', 'creators']);
const isProtected = name => PROTECTED.has(name) || name.startsWith('ca-salary-');
const BACKUP_FIXED = ['ca-sales', 'disputes', 'shifts', 'leave_requests'];

const WRITE = flag('write');
const VERIFY = flag('verify');
const DELETE = flag('delete');
const BACKUP = opt('backup');
const COLLECTION = opt('collection');
const TODAY = new Date().toISOString().slice(0, 10);
const DATE = opt('date') ?? TODAY;

if (!COLLECTION && !BACKUP) fail('Give --collection <name> or --backup <label>.');
if (COLLECTION && BACKUP) fail('Use --collection or --backup, not both.');
if (DELETE && BACKUP) fail('--delete is not available with --backup. A backup is never deleted by this script.');
if (DELETE && opt('confirm') !== COLLECTION) fail(`--delete needs --confirm ${COLLECTION} (type the exact collection name).`);
if (DELETE && isProtected(COLLECTION)) fail(`${COLLECTION} is a pay/schedule collection. This script never deletes those.`);

const credentials = (() => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) fail('FIREBASE_SERVICE_ACCOUNT is not set in src/.env.local');
  try {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    return fail('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }
})();
const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
if (!bucketName) fail('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set in src/.env.local');

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();
const { Timestamp, GeoPoint, DocumentReference } = admin.firestore;
const { Storage } = require('@google-cloud/storage');
const bucket = new Storage({ projectId: credentials.project_id, credentials }).bucket(bucketName);

// ── lossless encoding ───────────────────────────────────────────────────────
function encode(v) {
  if (v === null || v === undefined) return v === undefined ? { __t: 'undef' } : null;
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', path: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __t: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = encode(v[k]);
    return out;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return { __t: 'num', v: String(v) };
  return v;
}

// Canonical = keys sorted at every depth, so a hash does not depend on key order.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const hashDoc = (id, data) => crypto.createHash('sha256').update(`${id}\n${canonical(data)}`).digest('hex');

// ── paging over a collection by document id ─────────────────────────────────
async function* liveDocs(name) {
  let last;
  for (;;) {
    let q = db.collection(name).orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    for (const d of snap.docs) yield d;
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 1000) return;
  }
}

const objectNames = (prefix, name, date) => ({
  data: `${prefix}/${name}/${date}.ndjson.gz`,
  hashes: `${prefix}/${name}/${date}.hashes.ndjson.gz`,
  manifest: `${prefix}/${name}/${date}.manifest.json`,
});

// ── export ──────────────────────────────────────────────────────────────────
async function exportCollection(name, prefix) {
  const names = objectNames(prefix, name, DATE);
  const [exists] = await bucket.file(names.data).exists();
  if (exists) fail(`gs://${bucketName}/${names.data} already exists — exports are never overwritten. Pass a different --date.`);

  if (!WRITE) {
    const agg = await db.collection(name).count().get();
    console.log(`  [dry run] ${name}: ${agg.data().count} docs → gs://${bucketName}/${names.data}   (add --write)`);
    return;
  }

  console.log(`  ${name}: exporting…`);
  const dataHash = crypto.createHash('sha256');
  const dataGz = zlib.createGzip();
  const hashGz = zlib.createGzip();
  const dataOut = bucket.file(names.data).createWriteStream({ resumable: false, contentType: 'application/gzip' });
  const hashOut = bucket.file(names.hashes).createWriteStream({ resumable: false, contentType: 'application/gzip' });
  dataGz.on('data', c => dataHash.update(c));

  let count = 0;
  let hasSubcollections = false;
  const dataDone = pipeline(dataGz, dataOut);
  const hashDone = pipeline(hashGz, hashOut);
  for await (const d of liveDocs(name)) {
    const data = encode(d.data());
    dataGz.write(JSON.stringify({ id: d.id, data }) + '\n');
    hashGz.write(JSON.stringify({ id: d.id, hash: hashDoc(d.id, data) }) + '\n');
    count++;
    if (count % 5000 === 0) process.stdout.write(`    ${count}…\r`);
  }
  dataGz.end();
  hashGz.end();
  await Promise.all([dataDone, hashDone]);

  // Subcollections are not exported; say so in the manifest rather than pretending completeness.
  if (count > 0) {
    const sample = await db.collection(name).limit(1).get();
    hasSubcollections = (await sample.docs[0].ref.listCollections()).length > 0;
  }

  const manifest = {
    collection: name,
    date: DATE,
    exportedAt: new Date().toISOString(),
    count,
    dataFile: names.data,
    dataSha256: dataHash.digest('hex'),
    hashesFile: names.hashes,
    hashAlgorithm: 'sha256(id + "\\n" + canonical(encoded data))',
    subcollectionsExported: false,
    firstDocHasSubcollections: hasSubcollections,
  };
  await bucket.file(names.manifest).save(JSON.stringify(manifest, null, 2), { contentType: 'application/json', resumable: false });
  console.log(`  ✓ ${name}: ${count} docs → gs://${bucketName}/${names.data}${hasSubcollections ? '   ⚠ docs have subcollections (NOT exported)' : ''}`);
}

// ── verify ──────────────────────────────────────────────────────────────────
async function latestDate(prefix, name) {
  const [files] = await bucket.getFiles({ prefix: `${prefix}/${name}/` });
  const dates = files.map(f => /\/(\d{4}-\d{2}-\d{2})\.manifest\.json$/.exec(f.name)?.[1]).filter(Boolean).sort();
  return dates[dates.length - 1];
}

async function verifyCollection(name, prefix) {
  const date = opt('date') ?? (await latestDate(prefix, name));
  if (!date) fail(`No export found under gs://${bucketName}/${prefix}/${name}/`);
  const names = objectNames(prefix, name, date);
  const manifest = JSON.parse((await bucket.file(names.manifest).download())[0].toString('utf8'));

  // 1. The data file is intact (sha256 of the compressed bytes).
  const sha = crypto.createHash('sha256');
  const lines = [];
  await pipeline(
    bucket.file(names.data).createReadStream(),
    async function* (src) {
      for await (const c of src) {
        sha.update(c);
        yield c;
      }
    },
    zlib.createGunzip(),
    async function (src) {
      // A StringDecoder, not chunk.toString(): a multi-byte character (an accent, an emoji in a fan
      // name) split across two chunks would otherwise decode as U+FFFD on both sides, and that doc
      // would falsely read as a hash mismatch. The export itself was never affected.
      const decoder = new StringDecoder('utf8');
      let buf = '';
      for await (const c of src) {
        buf += decoder.write(c);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          lines.push(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
      buf += decoder.end();
      if (buf) lines.push(buf);
    },
  );
  const fileOk = sha.digest('hex') === manifest.dataSha256;

  // 2. Recompute each stored doc's hash from the file itself (catches a corrupt/edited export).
  const exported = new Map();
  let selfMismatch = 0;
  const hashLines = (await bucket.file(names.hashes).download().then(([b]) => zlib.gunzipSync(b).toString('utf8')))
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
  const recorded = new Map(hashLines.map(h => [h.id, h.hash]));
  for (const l of lines) {
    const { id, data } = JSON.parse(l);
    const h = hashDoc(id, data);
    exported.set(id, h);
    if (recorded.get(id) !== h) selfMismatch++;
  }

  // 3. Compare to the live collection.
  let live = 0;
  let missingFromExport = 0;
  let changedSinceExport = 0;
  const seen = new Set();
  for await (const d of liveDocs(name)) {
    live++;
    seen.add(d.id);
    const h = exported.get(d.id);
    if (h === undefined) missingFromExport++;
    else if (h !== hashDoc(d.id, encode(d.data()))) changedSinceExport++;
  }
  const deletedSinceExport = [...exported.keys()].filter(id => !seen.has(id)).length;

  const clean = fileOk && selfMismatch === 0 && exported.size === manifest.count && missingFromExport === 0 && changedSinceExport === 0 && deletedSinceExport === 0;
  console.log(`  ${clean ? '✓' : '✗'} ${name} (${date})`);
  console.log(`      export file intact: ${fileOk}   manifest count ${manifest.count}   rows read ${exported.size}   internal hash mismatches ${selfMismatch}`);
  console.log(`      live docs ${live}   missing from export ${missingFromExport}   changed since export ${changedSinceExport}   deleted since export ${deletedSinceExport}`);
  if (!clean && (fileOk && selfMismatch === 0)) console.log('      (drift since export is expected for a live collection; only a mismatch in the file itself means a bad export)');
  return { clean, fileIntact: fileOk && selfMismatch === 0 && exported.size === manifest.count };
}

// ── delete ──────────────────────────────────────────────────────────────────
async function deleteCollection(name, prefix) {
  const result = await verifyCollection(name, prefix);
  if (!result.clean) fail(`Refusing to delete ${name}: the export does not exactly match the live collection. Re-export (new --date) and verify again.`);

  const refs = await db.collection(name).listDocuments();
  for (const ref of refs.slice(0, 50)) {
    if ((await ref.listCollections()).length > 0) fail(`${name} has documents with subcollections (e.g. ${ref.path}); the export does not cover them. Refusing.`);
  }
  console.log(`  Deleting ${refs.length} docs from ${name} with bulkWriter…`);
  const writer = db.bulkWriter();
  let failed = 0;
  writer.onWriteError(err => {
    if (err.failedAttempts < 3) return true; // retry transient errors
    failed++;
    return false;
  });
  for (const ref of refs) writer.delete(ref);
  await writer.close();
  if (failed) fail(`${failed} deletes failed — the collection is partly deleted; the export is intact. Re-run to finish.`);
  console.log(`  ✓ ${name} deleted (${refs.length} docs). Export remains at gs://${bucketName}/${prefix}/${name}/`);
}

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n  Bucket: gs://${bucketName}   Project: ${credentials.project_id}   Date: ${DATE}`);

  let collections;
  let prefix;
  if (BACKUP) {
    prefix = `archive/backups/${BACKUP}`;
    const all = (await db.listCollections()).map(c => c.id);
    collections = [...BACKUP_FIXED, ...all.filter(n => n.startsWith('ca-salary-'))].filter((n, i, a) => a.indexOf(n) === i && all.includes(n));
    const missing = BACKUP_FIXED.filter(n => !all.includes(n));
    if (missing.length) console.log(`  ⚠ not present in Firestore (skipped): ${missing.join(', ')}`);
    console.log(`  Backup "${BACKUP}": ${collections.join(', ')}\n`);
  } else {
    prefix = opt('prefix') ?? 'archive/buddyx';
    collections = [COLLECTION];
    console.log('');
  }

  let allClean = true;
  for (const name of collections) {
    if (DELETE) await deleteCollection(name, prefix);
    else if (VERIFY) {
      const r = await verifyCollection(name, prefix);
      // A pay backup of live data is expected to drift; only a damaged file is a failure.
      if (BACKUP ? !r.fileIntact : !r.clean) allClean = false;
    } else await exportCollection(name, prefix);
  }
  if (VERIFY && !allClean) {
    console.log('\n  ✗ Verification failed.\n');
    process.exit(2);
  }
  console.log('');
  process.exit(0);
})().catch(err => {
  console.error('\n  ✗ Unexpected failure:', err);
  process.exit(1);
});
