'use strict';
// Run from the app root: cd src && node scripts/import-twitterx-management.js
// Add --dry-run to preview every change without writing anything.
//
// Two jobs, in order:
//
//  1. MIGRATE the existing `twitterx-accounts` docs
//     - isViralBonus = true on every existing account (they are all accounts
//       SMMs may copy viral posts from — that is what this flag means; the
//       'Bonus' *type* means something else: the account may submit for bonus)
//     - tier = null on every existing account (tiers are re-set by hand)
//
//  2. IMPORT "Twitter Management ..._all.csv" into the same collection.
//     Mapping (per SMM.md):
//       Account  → accountName   ("1️⃣"/"2️⃣" stripped and used to set tier)
//       Drive    → driveLink
//       Network  → 'Other' for every row
//       Role     → type: SFS→SFS, Uploads→Upload, 'Bonus 💰'→Bonus,
//                  'SPAM ERROR ❗️'→ status 'inactive'
//       SMM      → assigned (matched against the users collection, via
//                  SMM_NAME_ALIASES; names in SMM_LEAVE_UNASSIGNED stay unassigned)
//       Content Status / Date / Followers / Updated → ignored
//     accountLink is synthesised as https://x.com/<accountName>.
//     Imported accounts are NOT viral accounts (isViralBonus = false).
//
//     An account whose name ALREADY EXISTS is not duplicated and not skipped
//     either: its `assigned` is filled in from the sheet and the sheet's types
//     are APPENDED to whatever it already has (never overwritten). Re-running
//     is therefore safe and idempotent.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

// ─── .env.local ───────────────────────────────────────────────────────────────
// Initialised inside main(), not at import time, so the pure parsing helpers
// exported at the bottom can be exercised without credentials.
let db;
function initFirebase() {
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
  db = admin.firestore();
}

const CSV_PATH = path.join(
  __dirname, '../../Twitter Management f5231ef255dd41e88d108649198794d3_all.csv',
);
const ACCOUNTS = 'twitterx-accounts';
const BATCH_SIZE = 400;
const dryRun = process.argv.includes('--dry-run');

// ─── CSV parser (quote-aware — this file does use quoted fields) ─────────────
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Field mapping ───────────────────────────────────────────────────────────
const ROLE_TO_TYPE = {
  'sfs': 'SFS',
  'uploads': 'Upload',
  'bonus 💰': 'Bonus',
};
const SPAM_ROLE = 'spam error ❗️';

// The sheet's SMM column uses old/short names that no longer match any user doc.
const SMM_NAME_ALIASES = {
  'jereza bluu': 'Jereza Pagobo',
  'hanah bluu': 'Hanah Hatamosa',
};
// Names that must NOT be assigned to anyone — the account is still imported.
const SMM_LEAVE_UNASSIGNED = new Set(['rolan clive sarias']);

const TIER_MARKERS = [
  { marker: '1️⃣', tier: 1 },
  { marker: '2️⃣', tier: 2 },
];

/** Strip the tier marker (and a leading @) off the raw Account cell. */
function parseAccountCell(raw) {
  let name = (raw || '').trim();
  let tier = null;
  for (const { marker, tier: value } of TIER_MARKERS) {
    if (name.includes(marker)) {
      tier = value;
      name = name.split(marker).join('');
    }
  }
  name = name.trim();
  const hadAt = name.startsWith('@');
  if (hadAt) name = name.slice(1).trim();
  return { name, tier, hadAt };
}

/** Comparison key for duplicate detection — case/@/whitespace insensitive. */
function nameKey(name) {
  return (name || '').trim().replace(/^@/, '').replace(/\s+/g, '').toLowerCase();
}

function isUrl(value) {
  return /^https?:\/\/\S+$/i.test((value || '').trim());
}

// ─── Step 1: migrate existing accounts ───────────────────────────────────────
async function migrateExisting(existingDocs) {
  console.log(`\nStep 1 — migrating ${existingDocs.length} existing accounts (isViralBonus=true, tier=null)...`);
  if (dryRun) {
    console.log(`  [dry run] would update ${existingDocs.length} docs.`);
    return;
  }
  let done = 0;
  for (let i = 0; i < existingDocs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of existingDocs.slice(i, i + BATCH_SIZE)) {
      batch.update(doc.ref, { isViralBonus: true, tier: null });
    }
    await batch.commit();
    done += Math.min(BATCH_SIZE, existingDocs.length - i);
    process.stdout.write(`\r  Updated ${done}/${existingDocs.length}`);
  }
  console.log('');
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  initFirebase();

  console.log('Loading users...');
  const usersSnap = await db.collection('users').get();
  const uidsByName = {}; // normalised name → [uid, ...]
  const nameByUid = {};
  const addName = (name, uid) => {
    const key = (name || '').toLowerCase().trim();
    if (!key) return;
    (uidsByName[key] = uidsByName[key] || []).push(uid);
  };
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    if (d.isArchived) continue;
    const display = d.displayName || `${d.firstName || ''} ${d.lastName || ''}`.trim();
    nameByUid[doc.id] = display;
    addName(display, doc.id);
    addName(`${d.firstName || ''} ${d.lastName || ''}`.trim(), doc.id);
    addName(d.firstName, doc.id);
  }
  console.log(`  ${usersSnap.size} users loaded`);

  console.log('Loading existing twitterx-accounts...');
  const existingSnap = await db.collection(ACCOUNTS).get();
  const existingByName = new Map(); // name key → doc (for merging, not skipping)
  for (const doc of existingSnap.docs) {
    const key = nameKey(doc.data().accountName);
    if (key && !existingByName.has(key)) existingByName.set(key, doc);
  }
  console.log(`  ${existingSnap.size} existing accounts indexed`);

  await migrateExisting(existingSnap.docs);

  // ── Step 2: parse + import the CSV ────────────────────────────────────────
  console.log('\nStep 2 — importing the CSV...');
  const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  const header = rows.shift().map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const [cAccount, cDrive, cRole, cSmm] = ['Account', 'Drive', 'Role', 'SMM'].map(col);
  if ([cAccount, cDrive, cRole, cSmm].some((i) => i < 0)) {
    throw new Error(`Unexpected CSV header: ${header.join(', ')}`);
  }

  const failed = [];   // { row, name, reason } — neither created nor merged
  const warnings = []; // { row, name, message } — imported anyway
  const toCreate = [];
  const toMerge = [];  // { name, ref, updates, note } — account already existed
  const unmatchedSmm = {}; // raw SMM name → Set of accounts
  const seenInCsv = new Set(); // guards against the same account twice in the CSV

  /**
   * The sheet's SMM cell → a uid. Returns { assigned, note } — `note` is set
   * when the row is deliberately left unassigned rather than failing to match.
   */
  const resolveSmm = (rawSmm, accountName, rowNum) => {
    if (!rawSmm) return { assigned: null, note: null };
    const lower = rawSmm.toLowerCase();
    if (SMM_LEAVE_UNASSIGNED.has(lower)) {
      return { assigned: null, note: `SMM "${rawSmm}" is left unassigned by mapping` };
    }
    const resolved = SMM_NAME_ALIASES[lower] ?? rawSmm;
    const unique = [...new Set(uidsByName[resolved.toLowerCase()] || [])];
    if (unique.length === 1) return { assigned: unique[0], note: null };
    (unmatchedSmm[rawSmm] = unmatchedSmm[rawSmm] || new Set()).add(accountName);
    warnings.push({
      row: rowNum,
      name: accountName,
      message: unique.length === 0
        ? `SMM "${rawSmm}"${resolved !== rawSmm ? ` (mapped to "${resolved}")` : ''} matched no user — left unassigned`
        : `SMM "${rawSmm}" matched ${unique.length} users — left unassigned`,
    });
    return { assigned: null, note: null };
  };

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2; // 1-based, +1 for the header
    if (raw.every((cell) => (cell || '').trim() === '')) return; // blank line

    const { name, tier, hadAt } = parseAccountCell(raw[cAccount]);
    if (!name) {
      failed.push({ row: rowNum, name: '(blank)', reason: 'No account name' });
      return;
    }
    if (hadAt) {
      warnings.push({ row: rowNum, name, message: 'Leading "@" stripped from the account name' });
    }

    const key = nameKey(name);
    if (seenInCsv.has(key)) {
      failed.push({ row: rowNum, name, reason: 'Duplicate of an earlier row in this CSV' });
      return;
    }
    seenInCsv.add(key);

    // Role → type[] (+ the SPAM marker, which deactivates the account instead)
    const roles = (raw[cRole] || '').split(',').map((r) => r.trim()).filter(Boolean);
    const type = [];
    let status = 'active';
    for (const role of roles) {
      const lower = role.toLowerCase();
      if (lower === SPAM_ROLE) { status = 'inactive'; continue; }
      const mapped = ROLE_TO_TYPE[lower];
      if (mapped) { if (!type.includes(mapped)) type.push(mapped); }
      else warnings.push({ row: rowNum, name, message: `Unrecognised role "${role}" — ignored` });
    }

    // A tier is only meaningful on a bonus account, and a bonus account needs
    // one (see resolveTier in smmService) — flag both mismatches loudly.
    const isBonus = type.includes('Bonus');
    let finalTier = tier;
    if (tier && !isBonus) {
      finalTier = null;
      warnings.push({ row: rowNum, name, message: `Tier ${tier} dropped — the row has no "Bonus 💰" role` });
    }
    if (isBonus && !finalTier) {
      warnings.push({ row: rowNum, name, message: 'Bonus account with no tier marker — imported with tier null, an admin must set it' });
    }

    // Drive: the sheet uses this column for free-text notes too.
    const rawDrive = (raw[cDrive] || '').trim();
    let driveLink = '';
    if (rawDrive) {
      if (isUrl(rawDrive)) driveLink = rawDrive;
      else warnings.push({ row: rowNum, name, message: `Drive cell is not a link ("${rawDrive}") — imported with no drive link` });
    }

    // SMM → assigned
    const rawSmm = (raw[cSmm] || '').trim();
    const { assigned, note } = resolveSmm(rawSmm, name, rowNum);
    if (note) warnings.push({ row: rowNum, name, message: note });

    // ── The account already exists: merge instead of creating a duplicate ──
    const existingDoc = existingByName.get(key);
    if (existingDoc) {
      const current = existingDoc.data();
      const updates = {};
      const notes = [];

      // Assignment: only ever filled IN, never cleared — a blank/unmapped SMM
      // cell must not wipe an assignment the database already has.
      if (assigned && current.assigned !== assigned) {
        updates.assigned = assigned;
        notes.push(`assigned → ${nameByUid[assigned] || assigned}`);
      }

      // Types are APPENDED (union), never overwritten.
      const currentType = Array.isArray(current.type) ? current.type : [];
      const added = type.filter((t) => !currentType.includes(t));
      if (added.length > 0) {
        updates.type = [...currentType, ...added];
        notes.push(`type += ${added.join(', ')}`);
      }

      // Appending 'Bonus' makes this a bonus account, and a bonus account
      // without a tier is invalid (see resolveTier). Step 1 nulled every
      // existing tier, so take the one this row carries when it has a marker.
      const mergedType = updates.type ?? currentType;
      if (mergedType.includes('Bonus') && !current.tier) {
        if (finalTier) {
          updates.tier = finalTier;
          notes.push(`tier → ${finalTier}`);
        } else {
          warnings.push({ row: rowNum, name, message: 'Merged into an existing account as a Bonus account with no tier marker — an admin must set its tier' });
        }
      }

      if (status === 'inactive' && current.status !== 'inactive') {
        warnings.push({ row: rowNum, name, message: 'Row is SPAM ERROR ❗️ but the account already exists — status left untouched' });
      }

      if (Object.keys(updates).length > 0) {
        updates.lastUpdatedTime = FieldValue.serverTimestamp();
        toMerge.push({ name, ref: existingDoc.ref, updates, note: notes.join('; ') });
      } else {
        warnings.push({ row: rowNum, name, message: 'Already exists and needs no changes — left as is' });
      }
      return;
    }

    toCreate.push({
      name,
      doc: {
        accountName: name,
        accountLink: `https://x.com/${name}`,
        type,
        network: 'Other',
        tier: finalTier,
        isViralBonus: false,
        assigned,
        driveLink,
        comments: '',
        information: '',
        status,
        lastUpdatedTime: FieldValue.serverTimestamp(),
        lastUpdatedBy: '',
      },
    });
  });

  if (dryRun) {
    console.log(`  [dry run] would create ${toCreate.length} accounts and merge into ${toMerge.length} existing ones — no writes performed.`);
  } else {
    if (toMerge.length > 0) {
      for (let i = 0; i < toMerge.length; i += BATCH_SIZE) {
        const batch = db.batch();
        for (const { ref, updates } of toMerge.slice(i, i + BATCH_SIZE)) batch.update(ref, updates);
        await batch.commit();
      }
      console.log(`  Merged into ${toMerge.length} existing accounts`);
    }
    let created = 0;
    for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const { doc } of toCreate.slice(i, i + BATCH_SIZE)) {
        batch.set(db.collection(ACCOUNTS).doc(), doc);
      }
      await batch.commit();
      created += Math.min(BATCH_SIZE, toCreate.length - i);
      process.stdout.write(`\r  Created ${created}/${toCreate.length}`);
    }
    console.log('');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const inactive = toCreate.filter((e) => e.doc.status === 'inactive').length;
  const assignedCount = toCreate.filter((e) => e.doc.assigned).length;
  const tiered = toCreate.filter((e) => e.doc.tier).length;

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(dryRun ? '  SUMMARY (dry run — no writes performed)' : '  SUMMARY');
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(`  Existing accounts migrated  : ${existingSnap.size}`);
  console.log(`  Accounts ${dryRun ? 'to create' : 'created  '}         : ${toCreate.length}`);
  console.log(`  Existing accounts ${dryRun ? 'to merge' : 'merged  '} : ${toMerge.length}`);
  console.log(`    with a tier               : ${tiered}`);
  console.log(`    assigned to an SMM        : ${assignedCount}`);
  console.log(`    set inactive (SPAM ERROR) : ${inactive}`);
  console.log(`  Rows that failed to import  : ${failed.length}`);
  console.log(`  Warnings                    : ${warnings.length}`);
  console.log('══════════════════════════════════════════════════════════════════════');

  if (toMerge.length > 0) {
    console.log(`
── Merged into existing accounts (${toMerge.length}) ──────────────────────────`);
    for (const m of toMerge) console.log(`  ${m.name}  —  ${m.note}`);
  }

  if (failed.length > 0) {
    console.log(`\n── Failed rows — NOT imported (${failed.length}) ─────────────────────────`);
    for (const f of failed) console.log(`  [row ${f.row}] ${f.name}  —  ${f.reason}`);
  }

  if (warnings.length > 0) {
    console.log(`\n── Warnings — imported anyway (${warnings.length}) ───────────────────────`);
    for (const w of warnings) console.log(`  [row ${w.row}] ${w.name}  —  ${w.message}`);
  }

  if (Object.keys(unmatchedSmm).length > 0) {
    console.log(`\n── SMM names left unassigned (${Object.keys(unmatchedSmm).length}) ───────────────────`);
    for (const [smm, accounts] of Object.entries(unmatchedSmm)) {
      console.log(`  "${smm}"  →  ${[...accounts].join(', ')}`);
    }
  }

  console.log('\nDone!');
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

// Exported for the offline parser check (tests/scripts).
module.exports = { parseCSV, parseAccountCell, nameKey, isUrl, ROLE_TO_TYPE, SPAM_ROLE, CSV_PATH };
