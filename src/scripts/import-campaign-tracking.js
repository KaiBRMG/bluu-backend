'use strict';
// Run from repo root: cd src && node scripts/import-campaign-tracking.js
//
// What this script does:
//   CR / Call / Item entries — already exist in Firestore; patches createdBy + lastEditedBy.
//   BFE / VIP / Hubby entries — were skipped in the original import; creates them now.
//   Re-running is safe: duplicate detection via creatorID|fan|createdMs key.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');

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

// ─── CSV parser — handles quoted fields with embedded commas and newlines ─────
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

// Returns { type, callType, isCampaign } or null if the type string is unrecognised.
// isCampaign=true → BFE/VIP/Hubby (create path); isCampaign=false → CR/Call/Item (update path).
function mapType(s) {
  switch (s.trim()) {
    case 'CR':                        return { type: 'CR',    callType: null,          isCampaign: false };
    case 'Item':                      return { type: 'Item',  callType: null,          isCampaign: false };
    case 'Call - Voice (Clean)':      return { type: 'Call',  callType: 'Clean Voice', isCampaign: false };
    case 'Call - Video (Clean)':      return { type: 'Call',  callType: 'Clean Video', isCampaign: false };
    case 'Call - Video (Explicit)':   return { type: 'Call',  callType: 'NSFW Video',  isCampaign: false };
    case 'Call - Voice (Explicit)':   return { type: 'Call',  callType: 'NSFW Voice',  isCampaign: false };
    case 'BF Experience':             return { type: 'BFE',   callType: null,          isCampaign: true  };
    case 'VIP':                       return { type: 'VIP',   callType: null,          isCampaign: true  };
    case 'Hubby':                     return { type: 'Hubby', callType: null,          isCampaign: true  };
    default:                          return null;
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
  'queen':                  'queen oyindamola',
  'kai':                    'kai nell',
  'ayomide':                'ayomide olujimi',
};

// CSV short name → Firestore stageName (lowercase) for creators whose CSV name differs
const CREATOR_ALIASES = {
  'adam':    'adam horváth',
  'cole':    'cole bentley',
  'jackson': 'jackson lake',
  'liam':    'liam heng',
};

// ─── Main ─────────────────────────────────────────────────────────────────────
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
    const last  = (data.lastName  || '').toLowerCase().trim();
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

  // skippedEntries does NOT include duplicates (those are reported separately).
  const skippedEntries = []; // { reason, creator, fanName, type }
  const standardValid  = []; // CR / Call / Item → update createdBy / lastEditedBy
  const campaignValid  = []; // BFE / VIP / Hubby → create new docs

  for (const row of rows.slice(1)) {
    if (row.length < 18) continue;

    const rawType    = (row[19] || '').trim();
    const typeInfo   = mapType(rawType);
    const creatorRaw = (row[5]  || '').trim();
    const fanRaw     = (row[7]  || '').trim();
    const crRaw      = (row[2]  || '').trim();

    if (!typeInfo) {
      skippedEntries.push({
        reason:  `Unknown type: "${rawType || '(blank)'}"`,
        creator: creatorRaw || '—',
        fanName: fanRaw     || '—',
        type:    rawType    || '—',
        CR:      crRaw      || '—',
      });
      continue;
    }

    const creatorKey = creatorRaw.toLowerCase();
    const creator    = creatorKey ? creatorsByName[creatorKey] : null;
    if (!creator) {
      skippedEntries.push({
        reason:  'Unknown creator',
        creator: creatorRaw || '—',
        fanName: fanRaw     || '—',
        type:    rawType,
        CR:      crRaw      || '—',
      });
      continue;
    }

    if (typeInfo.isCampaign) {
      campaignValid.push({ row, typeInfo, creator });
    } else {
      standardValid.push({ row, typeInfo, creator, crCode: parseCRCode(crRaw) });
    }
  }

  // ── Load existing Firestore entries for duplicate detection ──────────────────
  console.log('\nLoading existing campaign-tracking entries...');
  const existingSnap = await db.collection('campaign-tracking').get();
  const existingByKey = {}; // "creatorID|fan:…|ms:…" → docId
  for (const doc of existingSnap.docs) {
    const d   = doc.data();
    const fan = (d.fanName || '').trim().toLowerCase();
    const ms  = d.createdTime?.toMillis?.() ?? 0;
    existingByKey[`${d.creatorID}|fan:${fan}|ms:${ms}`] = doc.id;
  }
  console.log(`  ${Object.keys(existingByKey).length} existing entries indexed`);

  const existingDataById = {};
  for (const doc of existingSnap.docs) existingDataById[doc.id] = doc.data();

  // ── Standard entries: assign CR codes then patch createdBy / lastEditedBy ───

  // Track max existing CR per creator, then assign codes to entries that need them
  const creatorMaxCR  = {}; // uid → highest numeric CR seen in CSV
  for (const e of standardValid) {
    if (e.crCode) {
      const n = crToNum(e.crCode);
      if (n > (creatorMaxCR[e.creator.uid] || 0)) creatorMaxCR[e.creator.uid] = n;
    }
  }
  const creatorNextCR = { ...creatorMaxCR };
  for (const e of standardValid) {
    if (!e.crCode) {
      const uid = e.creator.uid;
      creatorNextCR[uid] = (creatorNextCR[uid] || 0) + 1;
      e.crCode = formatCR(creatorNextCR[uid]);
    }
  }

  const updates        = [];
  let   standardNotFound = 0;
  let   alreadyPatched   = 0;
  const unmatchedNames = {}; // raw name → Set of "fan" labels

  for (const { row, creator } of standardValid) {
    const createdDate = parseDate(row[4]);
    const fan         = (row[7] || '').trim().toLowerCase();
    const ms          = createdDate ? createdDate.getTime() : 0;
    const key         = `${creator.uid}|fan:${fan}|ms:${ms}`;

    const docId = existingByKey[key];
    if (!docId) { standardNotFound++; continue; }

    // Skip entries already patched — preserves any manual edits made after import
    if (existingDataById[docId]?.createdBy) { alreadyPatched++; continue; }

    const chatterRaw    = (row[3] || '').trim();
    const chatterKey    = chatterRaw.split(',')[0].trim().toLowerCase();
    const createdBy     = chatterKey ? (usersByName[chatterKey] || '') : '';

    const lastEditedRaw = (row[8] || '').trim();
    const lastEditedBy  = lastEditedRaw ? (usersByName[lastEditedRaw.toLowerCase()] || '') : '';

    const label = (row[7] || '—').trim();
    if (chatterKey && !createdBy)   (unmatchedNames[chatterRaw]    = unmatchedNames[chatterRaw]    || new Set()).add(label);
    if (lastEditedRaw && !lastEditedBy) (unmatchedNames[lastEditedRaw] = unmatchedNames[lastEditedRaw] || new Set()).add(label);

    updates.push({ docId, createdBy, lastEditedBy });
  }

  console.log(`\nPatching ${updates.length} standard entries (${standardNotFound} had no matching doc, ${alreadyPatched} already patched/skipped)`);

  if (Object.keys(unmatchedNames).length > 0) {
    console.log(`\n── Unmatched user names (${Object.keys(unmatchedNames).length}) ──────────────────────────────`);
    for (const [name, labels] of Object.entries(unmatchedNames)) {
      console.log(`  "${name}"  (${labels.size} entries)`);
      for (const l of labels) console.log(`    ${l}`);
    }
  }

  if (updates.length > 0) {
    const BATCH_SIZE = 400;
    let patched = 0;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const { docId, createdBy, lastEditedBy } of updates.slice(i, i + BATCH_SIZE)) {
        batch.update(db.collection('campaign-tracking').doc(docId), { createdBy, lastEditedBy });
      }
      await batch.commit();
      patched += Math.min(BATCH_SIZE, updates.length - i);
      process.stdout.write(`\r  Patched ${patched}/${updates.length}`);
    }
    console.log('');
  }

  // ── Campaign entries (BFE / VIP / Hubby): create new docs ───────────────────
  const toCreate          = [];
  let   campaignDuplicates = 0;
  const campaignUnmatched  = {}; // raw name → Set of fan labels

  for (const { row, typeInfo, creator } of campaignValid) {
    const createdDate = parseDate(row[4]);
    const fanRaw      = (row[7] || '').trim();
    const fanKey      = fanRaw.toLowerCase();
    const ms          = createdDate ? createdDate.getTime() : 0;
    const key         = `${creator.uid}|fan:${fanKey}|ms:${ms}`;

    if (existingByKey[key]) {
      campaignDuplicates++;
      continue; // already imported — skip silently (not counted in skippedEntries)
    }

    const chatterRaw    = (row[3] || '').trim();
    const chatterKey    = chatterRaw.split(',')[0].trim().toLowerCase();
    const createdBy     = chatterKey ? (usersByName[chatterKey] || '') : '';

    const lastEditedRaw = (row[8] || '').trim();
    const lastEditedBy  = lastEditedRaw ? (usersByName[lastEditedRaw.toLowerCase()] || '') : '';

    const lastEditedDate = parseDate(row[9]);

    if (chatterKey && !createdBy)       (campaignUnmatched[chatterRaw]    = campaignUnmatched[chatterRaw]    || new Set()).add(fanRaw || '—');
    if (lastEditedRaw && !lastEditedBy) (campaignUnmatched[lastEditedRaw] = campaignUnmatched[lastEditedRaw] || new Set()).add(fanRaw || '—');

    const doc = {
      creatorID:      creator.uid,
      type:           typeInfo.type,
      fanName:        fanRaw,
      profileLink:    (row[13] || '').trim(),
      description:    (row[0]  || '').trim(),
      totalAmount:    parseAmount(row[18]),
      amountPaid:     parseAmount(row[11]),
      isArchived:     false,
      // 'In Progress' is the sentinel status for campaign entries (not surfaced on the campaigns page)
      status:         'In Progress',
      createdBy:      createdBy     || '',
      lastEditedBy:   lastEditedBy  || '',
      createdTime:    createdDate    ? Timestamp.fromDate(createdDate)    : Timestamp.now(),
      lastEditedTime: lastEditedDate ? Timestamp.fromDate(lastEditedDate) : (createdDate ? Timestamp.fromDate(createdDate) : Timestamp.now()),
    };

    // BFE has a length field; VIP and Hubby do not
    if (typeInfo.type === 'BFE') doc.length = (row[10] || '').trim();

    toCreate.push(doc);
  }

  console.log(`\nCreating ${toCreate.length} campaign entries (${campaignDuplicates} duplicates skipped)`);

  if (Object.keys(campaignUnmatched).length > 0) {
    console.log(`\n── Unmatched user names in campaign entries (${Object.keys(campaignUnmatched).length}) ──`);
    for (const [name, labels] of Object.entries(campaignUnmatched)) {
      console.log(`  "${name}"  (${labels.size} entries)`);
      for (const l of labels) console.log(`    ${l}`);
    }
  }

  if (toCreate.length > 0) {
    const BATCH_SIZE = 400;
    let created = 0;
    for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const doc of toCreate.slice(i, i + BATCH_SIZE)) {
        batch.set(db.collection('campaign-tracking').doc(), doc);
      }
      await batch.commit();
      created += Math.min(BATCH_SIZE, toCreate.length - i);
      process.stdout.write(`\r  Created ${created}/${toCreate.length}`);
    }
    console.log('');
  }

  // ── Skipped entries detail (unknown type / unknown creator) ──────────────────
  if (skippedEntries.length > 0) {
    console.log(`\n── Unrecognised rows (${skippedEntries.length}) ─────────────────────────────────────────`);
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
  }

  // ── Final summary ─────────────────────────────────────────────────────────────
  const unknownTypeCount    = skippedEntries.filter(e => e.reason.startsWith('Unknown type')).length;
  const unknownCreatorCount = skippedEntries.filter(e => e.reason === 'Unknown creator').length;
  const totalSkipped = campaignDuplicates + alreadyPatched + standardNotFound + skippedEntries.length;

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log('  Added');
  console.log(`    Campaign entries created (BFE/VIP/Hubby)   : ${toCreate.length}`);
  console.log(`    Standard entries patched (CR/Call/Item)     : ${updates.length}`);
  console.log('  Skipped');
  console.log(`    Already imported — campaign duplicates      : ${campaignDuplicates}`);
  console.log(`    Already patched  — standard entries         : ${alreadyPatched}`);
  console.log(`    No matching Firestore doc                   : ${standardNotFound}`);
  console.log(`    Unrecognised type                           : ${unknownTypeCount}`);
  console.log(`    Unrecognised creator                        : ${unknownCreatorCount}`);
  console.log(`    Total skipped                               : ${totalSkipped}`);
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
