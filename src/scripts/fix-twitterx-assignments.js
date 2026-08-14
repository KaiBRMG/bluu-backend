'use strict';
// Run from the app root: cd src && node scripts/fix-twitterx-assignments.js --dry-run
//
// One-off repair for `twitterx-accounts`.assigned — the assignments written by
// scripts/import-twitterx-management.js were wrong.
//
// This script IMPORTS NOTHING. It never creates a doc and never touches any
// field other than `assigned` (+ `lastUpdatedTime` on docs it changes). It:
//
//   1. Reads "Twitter Management ..._all.csv" and resolves its `SMM` column to
//      a uid (same alias table as the original import).
//   2. Walks EVERY doc in `twitterx-accounts`:
//        - matched by accountName to a CSV row → assigned = that row's uid
//          (which may itself be null when the SMM cell is blank)
//        - not in the CSV at all               → assigned = null (cleared)
//      i.e. after this runs, the sheet is the single source of truth for
//      assignment and nothing stale survives.
//   3. Writes only the docs whose `assigned` actually differs.
//
// Safety: if any SMM name in the sheet fails to resolve to exactly one user,
// the script prints the offenders and REFUSES to write (those accounts would
// be silently cleared). Fix SMM_NAME_ALIASES, or pass --force to accept it.
//
// Flags: --dry-run  preview every change, write nothing
//        --force    write even if some SMM names could not be resolved

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const { parseCSV, parseAccountCell, nameKey, CSV_PATH } = require('./import-twitterx-management.js');

const ACCOUNTS = 'twitterx-accounts';
const BATCH_SIZE = 400;
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

// The sheet's SMM column uses old/short names that no longer match any user doc.
const SMM_NAME_ALIASES = {
  'jereza bluu': 'Jereza Pagobo',
  'hanah bluu': 'Hanah Hatamosa',
};
// Names that must NOT be assigned to anyone — their accounts stay unassigned
// even though the sheet names them. Deliberate, not a failed name match.
const SMM_LEAVE_UNASSIGNED = new Set(['rolan clive sarias']);

// ─── .env.local ───────────────────────────────────────────────────────────────
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

async function main() {
  initFirebase();

  // ── Users ────────────────────────────────────────────────────────────────
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

  // ── CSV → { nameKey → uid|null } ─────────────────────────────────────────
  console.log('Parsing the CSV...');
  const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  const header = rows.shift().map((h) => h.trim());
  const cAccount = header.indexOf('Account');
  const cSmm = header.indexOf('SMM');
  if (cAccount < 0 || cSmm < 0) {
    throw new Error(`Unexpected CSV header: ${header.join(', ')}`);
  }

  const desiredByKey = new Map(); // nameKey → { uid|null, accountName, rawSmm, row }
  const unresolvedSmm = {};       // raw SMM name → { reason, accounts:Set }
  const csvProblems = [];         // { row, message }
  const leftUnassigned = [];      // { row, accountName, rawSmm } — SMM_LEAVE_UNASSIGNED

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2; // 1-based, +1 for the header
    if (raw.every((cell) => (cell || '').trim() === '')) return; // blank line

    const { name } = parseAccountCell(raw[cAccount]);
    if (!name) {
      csvProblems.push({ row: rowNum, message: 'No account name — row ignored' });
      return;
    }
    const key = nameKey(name);
    if (desiredByKey.has(key)) {
      csvProblems.push({ row: rowNum, message: `"${name}" duplicates an earlier row — later row ignored` });
      return;
    }

    const rawSmm = (raw[cSmm] || '').trim();
    let uid = null;
    if (rawSmm && SMM_LEAVE_UNASSIGNED.has(rawSmm.toLowerCase())) {
      leftUnassigned.push({ row: rowNum, accountName: name, rawSmm });
    } else if (rawSmm) {
      const resolved = SMM_NAME_ALIASES[rawSmm.toLowerCase()] ?? rawSmm;
      const unique = [...new Set(uidsByName[resolved.toLowerCase()] || [])];
      if (unique.length === 1) {
        uid = unique[0];
      } else {
        const reason = unique.length === 0
          ? `matched no user${resolved !== rawSmm ? ` (mapped to "${resolved}")` : ''}`
          : `matched ${unique.length} users (${unique.map((u) => nameByUid[u]).join(', ')})`;
        const entry = unresolvedSmm[rawSmm] || (unresolvedSmm[rawSmm] = { reason, accounts: new Set() });
        entry.accounts.add(name);
      }
    }
    desiredByKey.set(key, { uid, accountName: name, rawSmm, row: rowNum });
  });
  console.log(`  ${desiredByKey.size} account rows parsed`);

  // ── Refuse to write on an unresolved SMM name ────────────────────────────
  const unresolvedNames = Object.keys(unresolvedSmm);
  if (unresolvedNames.length > 0) {
    console.log(`\n⚠  ${unresolvedNames.length} SMM name(s) could not be resolved to a single user:`);
    for (const [smm, { reason, accounts }] of Object.entries(unresolvedSmm)) {
      console.log(`   "${smm}" — ${reason}`);
      console.log(`        affects: ${[...accounts].join(', ')}`);
    }
    if (!dryRun && !force) {
      console.log('\nRefusing to write — those accounts would be cleared to unassigned.');
      console.log('Fix SMM_NAME_ALIASES in this script, or re-run with --force to accept it.');
      process.exit(1);
    }
    console.log(dryRun ? '   (dry run — continuing)' : '   (--force — continuing; these accounts will be cleared)');
  }

  // ── Diff every account doc ───────────────────────────────────────────────
  console.log('\nLoading twitterx-accounts...');
  const accountsSnap = await db.collection(ACCOUNTS).get();
  console.log(`  ${accountsSnap.size} accounts loaded`);

  const changes = [];     // { ref, name, from, to }
  const matchedKeys = new Set();
  let unchanged = 0;

  for (const doc of accountsSnap.docs) {
    const data = doc.data();
    const key = nameKey(data.accountName);
    const row = key ? desiredByKey.get(key) : undefined;
    if (row) matchedKeys.add(key);

    const to = row ? row.uid : null;              // not in the sheet → cleared
    const from = data.assigned ?? null;
    if (from === to) { unchanged++; continue; }

    changes.push({ ref: doc.ref, name: data.accountName || '(unnamed)', from, to, inCsv: Boolean(row) });
  }

  const csvNotFound = [...desiredByKey.values()].filter((r) => !matchedKeys.has(nameKey(r.accountName)));

  // ── Write ────────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log(`\n[dry run] would update ${changes.length} accounts — no writes performed.`);
  } else if (changes.length > 0) {
    let done = 0;
    for (let i = 0; i < changes.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const c of changes.slice(i, i + BATCH_SIZE)) {
        batch.update(c.ref, { assigned: c.to, lastUpdatedTime: FieldValue.serverTimestamp() });
      }
      await batch.commit();
      done += Math.min(BATCH_SIZE, changes.length - i);
      process.stdout.write(`\r  Updated ${done}/${changes.length}`);
    }
    console.log('');
  } else {
    console.log('\nNothing to change.');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const assignedNow = changes.filter((c) => c.to).length;
  const clearedInCsv = changes.filter((c) => !c.to && c.inCsv).length;
  const clearedNotInCsv = changes.filter((c) => !c.to && !c.inCsv).length;

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(dryRun ? '  SUMMARY (dry run — no writes performed)' : '  SUMMARY');
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(`  Accounts in Firestore        : ${accountsSnap.size}`);
  console.log(`  Rows in the CSV              : ${desiredByKey.size}`);
  console.log(`  Accounts ${dryRun ? 'to change' : 'changed  '}          : ${changes.length}`);
  console.log(`    re-assigned to an SMM      : ${assignedNow}`);
  console.log(`    cleared (blank SMM in CSV) : ${clearedInCsv}`);
  console.log(`    cleared (not in the CSV)   : ${clearedNotInCsv}`);
  console.log(`    left unassigned by mapping : ${leftUnassigned.length} row(s) in the CSV`);
  console.log(`  Already correct              : ${unchanged}`);
  console.log(`  CSV rows with no account doc : ${csvNotFound.length}`);
  console.log('══════════════════════════════════════════════════════════════════════');

  if (changes.length > 0) {
    console.log(`\n── Changes (${changes.length}) ─────────────────────────────────────────`);
    for (const c of changes) {
      const fromLabel = c.from ? (nameByUid[c.from] || c.from) : '(unassigned)';
      const toLabel = c.to ? (nameByUid[c.to] || c.to) : '(unassigned)';
      console.log(`  ${c.name}: ${fromLabel}  →  ${toLabel}${c.inCsv ? '' : '   [not in CSV]'}`);
    }
  }

  if (csvNotFound.length > 0) {
    console.log(`\n── CSV rows with no matching account doc (${csvNotFound.length}) ────────────`);
    for (const r of csvNotFound) {
      console.log(`  [row ${r.row}] ${r.accountName}${r.rawSmm ? `  (SMM: ${r.rawSmm})` : ''}`);
    }
  }

  if (leftUnassigned.length > 0) {
    console.log(`\n── Left unassigned by mapping (${leftUnassigned.length}) ─────────────────────`);
    for (const r of leftUnassigned) {
      console.log(`  [row ${r.row}] ${r.accountName}  —  SMM "${r.rawSmm}" is never assigned`);
    }
  }

  if (csvProblems.length > 0) {
    console.log(`\n── CSV rows ignored (${csvProblems.length}) ──────────────────────────────`);
    for (const p of csvProblems) console.log(`  [row ${p.row}] ${p.message}`);
  }

  console.log('\nDone!');
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
