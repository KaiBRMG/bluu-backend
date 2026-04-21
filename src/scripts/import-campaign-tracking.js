'use strict';
// Run from repo root: cd src && node scripts/import-campaign-tracking.js

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');

// Load .env.local
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

// CSV parser — handles quoted fields with embedded commas and newlines
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r' && next === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; }
      else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else { field += ch; }
    }
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function parseAmount(s) {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseDate(s) {
  if (!s) return null;
  const cleaned = s.trim().replace(/\s*\(GMT[+-]\d+\)/, '').replace(/\s+\d{1,2}:\d{2}\s*$/, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

// "CR001", "CR26", "CR 45" → valid; "CRxx", "" → null
function parseCRCode(s) {
  if (!s) return null;
  const t = s.trim().replace(/^(CR)\s+(\d+)$/i, '$1$2');
  return /^CR\d+$/i.test(t) ? t.toUpperCase() : null;
}

function crToNum(cr) {
  if (!cr) return 0;
  return parseInt(cr.replace(/^CR0*/i, '') || '0', 10);
}

function formatCR(n) {
  return `CR${String(n).padStart(4, '0')}`;
}

// Returns { type, callType } or null to skip
function mapType(s) {
  switch (s.trim()) {
    case 'CR':                     return { type: 'CR',   callType: null };
    case 'Item':                   return { type: 'Item', callType: null };
    case 'Call - Voice (Clean)':   return { type: 'Call', callType: 'Clean Voice' };
    case 'Call - Video (Clean)':   return { type: 'Call', callType: 'Clean Video' };
    case 'Call - Video (Explicit)':return { type: 'Call', callType: 'NSFW Video' };
    case 'Call - Voice (Explicit)':return { type: 'Call', callType: 'NSFW Voice' };
    default: return null; // VIP, BF Experience, Hubby — skip
  }
}

function mapStatus(s) {
  const lower = (s || '').toLowerCase().trim();
  if (lower === 'completed') return 'Completed';
  if (lower === 'in progress') return 'In Progress';
  if (lower === 'rejected') return 'Rejected';
  return 'Awaiting Approval';
}

// CSV name → "firstname lastname" (lowercase) for users whose CSV name differs from Firestore
const USER_ALIASES = {
  'ajise damilola feranmi': 'damilola feranmi',
  'jessy':                  'jessiree sese',
  'mannie':                 'adeniran adebari',
  'queen':                 'queen oyindamola',
  'kai': 'kai nell',
  'ayomide': 'ayomide olujimi'
};

// CSV short name → Firestore stageName (lowercase) for creators whose CSV name differs
const CREATOR_ALIASES = {
  'adam':    'adam horváth',
  'cole':    'cole bentley',
  'jackson': 'jackson lake',
  'liam':    'liam heng',
};


async function main() {
  console.log('Loading creators...');
  const creatorsSnap = await db.collection('creators').get();
  const creatorsByName = {}; // stageName.lower → { uid, stageName }
  const creatorUidToName = {};
  for (const doc of creatorsSnap.docs) {
    const data = doc.data();
    const key = (data.stageName || '').toLowerCase().trim();
    if (key) creatorsByName[key] = { uid: doc.id, stageName: data.stageName };
    creatorUidToName[doc.id] = data.stageName || doc.id;
  }
  // Register aliases so CSV short names resolve correctly
  for (const [alias, fullName] of Object.entries(CREATOR_ALIASES)) {
    if (creatorsByName[fullName] && !creatorsByName[alias]) {
      creatorsByName[alias] = creatorsByName[fullName];
    }
  }
  console.log(`  ${Object.keys(creatorsByName).length} creators loaded (with aliases)`);

  console.log('Loading users...');
  const usersSnap = await db.collection('users').get();
  const usersByName = {}; // "firstname lastname".lower → uid
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const first = (data.firstName || '').toLowerCase().trim();
    const last = (data.lastName || '').toLowerCase().trim();
    const fullName = [first, last].filter(Boolean).join(' ');
    if (fullName) usersByName[fullName] = doc.id;
  }
  for (const [alias, fullName] of Object.entries(USER_ALIASES)) {
    if (usersByName[fullName] && !usersByName[alias]) {
      usersByName[alias] = usersByName[fullName];
    }
  }
  console.log(`  ${Object.keys(usersByName).length} users loaded (with aliases)`);

  const csvPath = path.join(__dirname, '../../Campaign Tracking 1986a3e187d9803ab940f2f6028045c2_all.csv');
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  console.log(`  ${rows.length - 1} data rows parsed`);

  // CSV columns (0-indexed):
  // 0:Description  1:Address  2:CR  3:Chatter  4:Created time  5:Creator  6:Date(due)
  // 7:Fan Name  8:Last edited by  9:Last edited time  10:Length  11:Paid
  // 12:Payment Progress(skip)  13:Profile Link  14:Remaining Amount(skip)
  // 15:Social Platform  16:Social Username  17:Status  18:Total Amount  19:Type

  const skippedEntries = []; // { reason, creator, fanName, type, CR }
  const valid = [];

  for (const row of rows.slice(1)) {
    if (row.length < 18) continue;

    const rawType = (row[19] || '').trim();
    const typeInfo = mapType(rawType);
    if (!typeInfo) {
      skippedEntries.push({ reason: rawType || '(blank)', creator: (row[5] || '—').trim(), fanName: (row[7] || '—').trim(), type: rawType || '—', CR: (row[2] || '—').trim() });
      continue;
    }

    const creatorName = (row[5] || '').trim().toLowerCase();
    const creator = creatorName ? creatorsByName[creatorName] : null;
    if (!creator) {
      skippedEntries.push({ reason: 'Unknown creator', creator: (row[5] || '—').trim(), fanName: (row[7] || '—').trim(), type: rawType, CR: (row[2] || '—').trim() });
      continue;
    }

    valid.push({ row, typeInfo, creator, crCode: parseCRCode(row[2]) });
  }

  // Track max existing CR per creator, then assign codes to entries that need them
  const creatorMaxCR = {}; // uid → highest numeric CR seen
  for (const e of valid) {
    if (e.crCode) {
      const n = crToNum(e.crCode);
      if (n > (creatorMaxCR[e.creator.uid] || 0)) creatorMaxCR[e.creator.uid] = n;
    }
  }

  const creatorNextCR = { ...creatorMaxCR };
  for (const e of valid) {
    if (!e.crCode) {
      const uid = e.creator.uid;
      creatorNextCR[uid] = (creatorNextCR[uid] || 0) + 1;
      e.crCode = formatCR(creatorNextCR[uid]);
    }
  }

  // Index existing entries by creatorID|fan|createdMs so we can match without relying on CR
  // (CR may have been auto-generated and won't appear in the CSV row)
  console.log('\nLoading existing campaign-tracking entries...');
  const existingSnap = await db.collection('campaign-tracking').get();
  const existingByKey = {}; // "creatorID|fan|ms" → docId
  for (const doc of existingSnap.docs) {
    const d = doc.data();
    const fan = (d.fanName || '').trim().toLowerCase();
    const createdMs = d.createdTime?.toMillis?.() ?? 0;
    const key = `${d.creatorID}|fan:${fan}|ms:${createdMs}`;
    existingByKey[key] = doc.id;
  }
  console.log(`  ${Object.keys(existingByKey).length} existing entries indexed`);

  // Build updates: match each CSV row to its existing Firestore doc, then fix createdBy/lastEditedBy
  const updates = [];
  let notFound = 0;
  const unmatchedNames = {}; // raw name → Set of "CR / fan" labels

  for (const { row, creator } of valid) {
    const createdDate = parseDate(row[4]);
    const fan = (row[7] || '').trim().toLowerCase();
    const createdMs = createdDate ? createdDate.getTime() : 0;
    const key = `${creator.uid}|fan:${fan}|ms:${createdMs}`;

    const docId = existingByKey[key];
    if (!docId) { notFound++; continue; }

    const chatterRaw = (row[3] || '').trim();
    const chatterKey = chatterRaw.split(',')[0].trim().toLowerCase();
    const createdBy = chatterKey ? (usersByName[chatterKey] || '') : '';

    const lastEditedRaw = (row[8] || '').trim();
    const lastEditedBy = lastEditedRaw ? (usersByName[lastEditedRaw.toLowerCase()] || '') : '';

    const label = `${(row[2] || '—').trim()} / ${(row[7] || '—').trim()}`;
    if (chatterKey && !createdBy) {
      (unmatchedNames[chatterRaw] = unmatchedNames[chatterRaw] || new Set()).add(label);
    }
    if (lastEditedRaw && !lastEditedBy) {
      (unmatchedNames[lastEditedRaw] = unmatchedNames[lastEditedRaw] || new Set()).add(label);
    }

    updates.push({ docId, createdBy, lastEditedBy });
  }

  console.log(`\nUpdating ${updates.length} entries (${notFound} CSV rows had no matching Firestore doc, ${skippedEntries.length} skipped)`);

  if (Object.keys(unmatchedNames).length > 0) {
    console.log(`\n── Unmatched names (${Object.keys(unmatchedNames).length}) ──────────────────────────────`);
    for (const [name, labels] of Object.entries(unmatchedNames)) {
      console.log(`  "${name}"  (${labels.size} entries)`);
      for (const l of labels) console.log(`    ${l}`);
    }
    console.log('');
  }

  if (updates.length === 0) {
    console.log('Nothing to update.');
  } else {
    const BATCH_SIZE = 400;
    let updated = 0;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const { docId, createdBy, lastEditedBy } of updates.slice(i, i + BATCH_SIZE)) {
        batch.update(db.collection('campaign-tracking').doc(docId), { createdBy, lastEditedBy });
      }
      await batch.commit();
      updated += Math.min(BATCH_SIZE, updates.length - i);
      console.log(`  Updated ${updated}/${updates.length}`);
    }
  }

  // Skipped entries summary
  if (skippedEntries.length > 0) {
    console.log(`\n── Skipped entries (${skippedEntries.length}) ──────────────────────────────`);
    // Group by reason
    const byReason = {};
    for (const e of skippedEntries) {
      (byReason[e.reason] = byReason[e.reason] || []).push(e);
    }
    for (const [reason, entries] of Object.entries(byReason)) {
      console.log(`\n  ${reason} (${entries.length}):`);
      for (const e of entries) {
        const cr = e.CR && e.CR !== '—' ? `[${e.CR}] ` : '';
        console.log(`    ${cr}${e.creator} / ${e.fanName}  (${e.type})`);
      }
    }
    console.log('');
  }

  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
