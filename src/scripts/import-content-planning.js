'use strict';
// Run from src/: cd src && node scripts/import-content-planning.js
//
// Imports data from the root-level Content Planning CSV into the
// 'content-planning' Firestore collection.
//
// Re-running is safe: duplicate detection via _csvImportId field.
// Entries already imported are skipped with a clear reason.
//
// Note: contentType defaults to "SFW" for all entries — update in the
// manager interface where needed, as the CSV has no SFW/NSFW column.

const fs   = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');

// ─── Load .env.local ──────────────────────────────────────────────────────────

const envPath = path.join(__dirname, '../.env.local');
if (!fs.existsSync(envPath)) {
  console.error('ERROR: src/.env.local not found. Run this script from src/.');
  process.exit(1);
}
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

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT not set in src/.env.local');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});
const db = admin.firestore();

// ─── CSV parser — handles quoted fields with embedded commas ──────────────────

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch   = text[i];
    const next = text[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuote = false; }
      else                            { field += ch; }
    } else {
      if (ch === '"')                               { inQuote = true; }
      else if (ch === ',')                          { row.push(field); field = ''; }
      else if (ch === '\r' && next === '\n')        { row.push(field); field = ''; rows.push(row); row = []; i++; }
      else if (ch === '\n' || ch === '\r')          { row.push(field); field = ''; rows.push(row); row = []; }
      else                                          { field += ch; }
    }
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Description parser ───────────────────────────────────────────────────────
// Splits on " + " and extracts leading quantity patterns like "1x", "x1", "10 ".

function parseDescription(text) {
  if (!text || !text.trim()) return [];

  const parts = text.split(/\s+\+\s+/).map(p => p.trim()).filter(Boolean);

  return parts.map(part => {
    // "1x ...", "2x ...", "1 x ...", "10x ..."
    const m1 = part.match(/^(\d+)\s*[xX]\s+(.+)$/);
    // "x1 ...", "x2 ..."
    const m2 = part.match(/^[xX]\s*(\d+)\s+(.+)$/);
    // "10 photos", "30 various photos..."
    const m3 = part.match(/^(\d+)\s+(.+)$/);

    if (m1) return { qty: m1[1],      content: m1[2].trim() };
    if (m2) return { qty: m2[1],      content: m2[2].trim() };
    if (m3) return { qty: m3[1],      content: m3[2].trim() };
    return          { qty: '',         content: part };
  });
}

// ─── Status mapper ────────────────────────────────────────────────────────────

function mapStatus(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'done') return 'Completed';
  return 'Outstanding'; // 'not started', 'in progress', blank
}

// ─── Date parsers ─────────────────────────────────────────────────────────────

function parseCreatedAt(raw) {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw.trim());
  return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

function parseDueDate(raw) {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ─── Creator aliases (CSV name → Firestore stageName, lowercase) ──────────────

const CREATOR_ALIASES = {
  'adam':    'adam horváth',
  'cole':    'cole bentley',
  'jackson': 'jackson lake',
  'liam':    'liam heng',
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Content Planning CSV Import                ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Locate CSV (one directory up from src/)
  const csvPath = path.join(__dirname, '../../Content Planning 2106a3e187d980898b5bc9f721ced348_all.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`ERROR: CSV not found at:\n  ${csvPath}`);
    process.exit(1);
  }

  // Parse CSV
  const raw   = fs.readFileSync(csvPath, 'utf8');
  const allRows = parseCSV(raw);
  if (allRows.length < 2) { console.error('ERROR: CSV appears empty.'); process.exit(1); }

  const headers = allRows[0].map(h => h.trim());
  const dataRows = allRows.slice(1).filter(r => r.some(c => c.trim())); // skip fully blank rows

  console.log(`CSV headers : ${headers.join(' | ')}`);
  console.log(`Data rows   : ${dataRows.length}\n`);

  // Build header index for easy lookup
  const col = name => headers.indexOf(name);
  const iContent     = col('Content');
  const iCreator     = col('Creator');
  const iDateReq     = col('Date Requested');
  const iDescription = col('Description');
  const iDueDate     = col('Due Date');
  const iStatus      = col('Status');

  const missing = [['Content', iContent], ['Creator', iCreator], ['Date Requested', iDateReq],
                   ['Description', iDescription], ['Due Date', iDueDate], ['Status', iStatus]]
    .filter(([, idx]) => idx === -1).map(([name]) => name);
  if (missing.length) {
    console.error(`ERROR: Missing expected columns: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Fetch creators: build map lowercase stageName → creatorID
  console.log('Fetching creators from Firestore...');
  const creatorsSnap = await db.collection('creators').get();
  const creatorsByName = {};
  for (const doc of creatorsSnap.docs) {
    const data = doc.data();
    if (data.stageName) {
      creatorsByName[data.stageName.toLowerCase()] = {
        creatorID: data.creatorID || doc.id,
        stageName: data.stageName,
      };
    }
  }
  console.log(`Found ${Object.keys(creatorsByName).length} creators in Firestore.\n`);

  // Fetch existing _csvImportId values to detect duplicates
  console.log('Checking for previously imported entries...');
  const existingSnap = await db.collection('content-planning')
    .where('_csvImportId', '!=', null)
    .select('_csvImportId')
    .get();
  const existingIds = new Set();
  for (const doc of existingSnap.docs) {
    const id = doc.data()._csvImportId;
    if (id) existingIds.add(id);
  }
  console.log(`Previously imported: ${existingIds.size} entries.\n`);
  console.log('Processing rows...\n');

  // Stats
  const stats = {
    imported:              0,
    skippedDuplicate:      0,
    skippedNoCreator:      0,
    skippedCreatorUnknown: 0,
    skippedBadDate:        0,
  };

  const MAX_BATCH = 499;
  let batch      = db.batch();
  let batchCount = 0;

  const flushBatch = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    batch      = db.batch();
    batchCount = 0;
  };

  for (let i = 0; i < dataRows.length; i++) {
    const r      = dataRows[i];
    const rowNum = i + 2; // account for 1-index + header row
    const get    = idx => (r[idx] || '').trim();

    const contentSummary  = get(iContent) || 'New Content';
    const creatorRaw      = get(iCreator);
    const dateRequestedRaw = get(iDateReq);
    const descriptionRaw  = get(iDescription);
    const dueDateRaw      = get(iDueDate);
    const statusRaw       = get(iStatus);

    // ── Validation ─────────────────────────────────────────────────────────────

    if (!creatorRaw) {
      stats.skippedNoCreator++;
      console.log(`  [row ${rowNum}] "${contentSummary}" — SKIP: no creator specified`);
      continue;
    }

    // Resolve alias → stageName → Firestore creator doc
    const normalised    = creatorRaw.toLowerCase();
    const resolvedName  = CREATOR_ALIASES[normalised] ?? normalised;
    const creatorDoc    = creatorsByName[resolvedName];

    if (!creatorDoc) {
      stats.skippedCreatorUnknown++;
      console.log(`  [row ${rowNum}] "${contentSummary}" — SKIP: creator "${creatorRaw}" not found in Firestore (resolved to "${resolvedName}")`);
      continue;
    }

    const createdAt = parseCreatedAt(dateRequestedRaw);
    if (!createdAt) {
      stats.skippedBadDate++;
      console.log(`  [row ${rowNum}] "${contentSummary}" — SKIP: cannot parse Date Requested "${dateRequestedRaw}"`);
      continue;
    }

    // ── Duplicate check ────────────────────────────────────────────────────────

    const csvImportId = `csv:${creatorDoc.creatorID}:${contentSummary.toLowerCase()}:${createdAt.toDate().toISOString()}`;

    if (existingIds.has(csvImportId)) {
      stats.skippedDuplicate++;
      console.log(`  [row ${rowNum}] "${contentSummary}" (${creatorDoc.stageName}) — SKIP: already imported`);
      continue;
    }

    // ── Build document ─────────────────────────────────────────────────────────

    const status      = mapStatus(statusRaw);
    const dueDate     = parseDueDate(dueDateRaw);
    const description = parseDescription(descriptionRaw);

    const docRef = db.collection('content-planning').doc();
    batch.set(docRef, {
      contentType:   'SFW',      // no SFW/NSFW column in CSV; update via manager UI
      contentSummary,
      description,
      comment:       '',
      dueDate:       dueDate ?? null,
      createdAt,
      completedAt:   null,
      lastEditedAt:  null,
      lastEditedBy:  null,
      status,
      creatorID:     creatorDoc.creatorID,
      isArchived:    false,
      _csvImportId:  csvImportId,
    });

    existingIds.add(csvImportId); // prevent intra-run duplicates
    batchCount++;
    stats.imported++;

    console.log(`  [row ${rowNum}] "${contentSummary}" (${creatorDoc.stageName}) → ${status}${dueDate ? ` · due ${dueDate}` : ''}`);

    if (batchCount >= MAX_BATCH) {
      await flushBatch();
      console.log(`\n  [batch] Committed ${MAX_BATCH} documents.\n`);
    }
  }

  await flushBatch();

  // ── Summary ────────────────────────────────────────────────────────────────

  const totalSkipped = stats.skippedDuplicate + stats.skippedNoCreator +
                       stats.skippedCreatorUnknown + stats.skippedBadDate;

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Import Summary                             ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  ✅  Imported:                  ${String(stats.imported).padEnd(13)} ║`);
  console.log(`║  ──  Total skipped:             ${String(totalSkipped).padEnd(13)} ║`);
  console.log(`║      ↳ Already imported:        ${String(stats.skippedDuplicate).padEnd(13)} ║`);
  console.log(`║      ↳ No creator in row:       ${String(stats.skippedNoCreator).padEnd(13)} ║`);
  console.log(`║      ↳ Creator not in Firestore:${String(stats.skippedCreatorUnknown).padEnd(13)} ║`);
  console.log(`║      ↳ Invalid date:            ${String(stats.skippedBadDate).padEnd(13)} ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Total rows processed:          ${String(stats.imported + totalSkipped).padEnd(13)} ║`);
  console.log('╚══════════════════════════════════════════════╝');

  if (stats.skippedCreatorUnknown > 0) {
    console.log('\n⚠️  Some creators were not found in Firestore.');
    console.log('   Check the creator aliases at the top of this script');
    console.log('   and ensure the stageName matches exactly.');
  }
  if (stats.imported > 0) {
    console.log('\n📝 Note: contentType defaults to "SFW" for all imported entries.');
    console.log('   Review and update via the Content Planning manager interface.');
  }

  console.log('\n✨ Done.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message || err);
  process.exit(1);
});
