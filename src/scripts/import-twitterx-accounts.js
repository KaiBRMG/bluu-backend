'use strict';
// Run from repo root: cd src && node scripts/import-twitterx-accounts.js
// Add --dry-run to preview the summary without writing anything.
//
// Imports "BLUU _ Creator Database.csv" into the `twitterx-accounts` collection.
//
// CSV columns: A=accountName  B=accountLink  C=(ignore)  D=type  E=assigned (first name)
// Network is derived from section headers in col A, not fixed row numbers:
//   "INHOUSE CREATORS"     → network 'Inhouse'
//   "X MANAGED CREATORS"   → network 'X Managed'
//   "TWINK NETWORK"        → network 'Twink'
//   "ALL OTHER CREATORS"   → network 'Other'
//
// Re-running is safe: existing accounts are matched by normalized accountLink
// and skipped.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

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

// ─── CSV parser ──────────────────────────────────────────────────────────────
// The source file has no quoted fields (verified: a single stray, unmatched
// `"` sits in the header text itself) — a straight line/delimiter split is
// used rather than quote-aware parsing, which would mis-toggle on that stray
// quote and swallow the rest of the file into one field.
function parseCSV(text, delimiter) {
  return text
    .replace(/^﻿/, '') // strip BOM
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.split(delimiter));
}

// ─── Domain constants (mirrors src/types/firestore.ts) ─────────────────────
const SMM_ACCOUNT_TYPES = new Set([
  'Twink', 'Twunk', 'Hunk/Jock', 'Couple', 'Daddy',
  'Artist', 'Animator', 'SFS', 'Upload', 'Bonus',
]);

const SECTION_NETWORK = {
  'inhouse creators': 'Inhouse',
  'x managed creators': 'X Managed',
  'twink network': 'Twink',
  'all other creators': 'Other',
};

function normalizeLink(url) {
  let link = (url || '').trim().toLowerCase();
  link = link.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/^www\./, '');
  return link;
}

function isValidLink(url) {
  return /^https?:\/\/.+/i.test((url || '').trim());
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('Loading users...');
  const usersSnap = await db.collection('users').get();
  const uidsByFirstName = {}; // firstname.lower → [uid, ...]
  const nameByUid = {};
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (data.isArchived) continue;
    const first = (data.firstName || '').toLowerCase().trim();
    if (!first) continue;
    (uidsByFirstName[first] = uidsByFirstName[first] || []).push(doc.id);
    nameByUid[doc.id] = data.displayName || `${data.firstName} ${data.lastName}`.trim();
  }
  console.log(`  ${usersSnap.size} users loaded (${Object.keys(uidsByFirstName).length} distinct first names)`);

  console.log('Loading existing twitterx-accounts...');
  const existingSnap = await db.collection('twitterx-accounts').get();
  const existingLinks = new Set();
  for (const doc of existingSnap.docs) {
    const link = normalizeLink(doc.data().accountLink);
    if (link) existingLinks.add(link);
  }
  console.log(`  ${existingSnap.size} existing accounts indexed`);

  const csvPath = path.join(__dirname, 'BLUU _ Creator Database.csv');
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'), ';');

  const skipped = []; // { row, name, reason }
  const warnings = []; // { row, name, message } — non-blocking, row is still imported
  const toCreate = []; // { doc, name, assignedLabel }
  const ambiguousAssignments = {}; // raw assigned name → Set of account names
  const unmatchedAssignments = {}; // raw assigned name → Set of account names

  let currentNetwork = null; // null until first section header is seen
  let rowNum = 0; // running spreadsheet-like row count (for reporting only)

  for (const row of rows) {
    rowNum++;
    const [rawName, rawLink, , rawType, rawAssigned] = row.map((c) => (c ?? '').trim());

    if (!rawName && !rawLink && !rawType && !rawAssigned) continue; // blank padding row

    const sectionKey = rawName.toLowerCase();
    if (sectionKey in SECTION_NETWORK) {
      currentNetwork = SECTION_NETWORK[sectionKey];
      continue;
    }

    if (!currentNetwork) continue; // rows before the first recognised section header

    if (!rawName) continue; // stray blank-name row inside a section

    if (!isValidLink(rawLink)) {
      skipped.push({ row: rowNum, name: rawName, reason: rawLink ? `Invalid account link: "${rawLink}"` : 'Missing account link' });
      continue;
    }

    const normLink = normalizeLink(rawLink);
    if (existingLinks.has(normLink)) {
      skipped.push({ row: rowNum, name: rawName, reason: 'Already exists (matched by accountLink)' });
      continue;
    }

    let type = [];
    if (rawType) {
      if (SMM_ACCOUNT_TYPES.has(rawType)) {
        type = [rawType];
      } else {
        warnings.push({ row: rowNum, name: rawName, message: `Unrecognised type "${rawType}" — imported with no type` });
      }
    }

    let assigned = null;
    if (rawAssigned) {
      const key = rawAssigned.toLowerCase();
      const matches = uidsByFirstName[key] || [];
      if (matches.length === 1) {
        assigned = matches[0];
      } else if (matches.length > 1) {
        (ambiguousAssignments[rawAssigned] = ambiguousAssignments[rawAssigned] || new Set()).add(rawName);
      } else {
        (unmatchedAssignments[rawAssigned] = unmatchedAssignments[rawAssigned] || new Set()).add(rawName);
      }
    }

    existingLinks.add(normLink); // guard against dupes within the CSV itself

    toCreate.push({
      name: rawName,
      assignedLabel: assigned ? nameByUid[assigned] : (rawAssigned || null),
      doc: {
        accountName: rawName,
        accountLink: rawLink,
        type,
        network: currentNetwork,
        tier: 1,
        assigned,
        driveLink: '',
        comments: '',
        information: '',
        status: 'active',
        lastUpdatedTime: FieldValue.serverTimestamp(),
        lastUpdatedBy: '',
      },
    });
  }

  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log(`\n[dry run] Would create ${toCreate.length} accounts — no writes performed.`);
  } else if (toCreate.length > 0) {
    console.log(`\nCreating ${toCreate.length} accounts...`);
    const BATCH_SIZE = 400;
    let created = 0;
    for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const { doc } of toCreate.slice(i, i + BATCH_SIZE)) {
        batch.set(db.collection('twitterx-accounts').doc(), doc);
      }
      await batch.commit();
      created += Math.min(BATCH_SIZE, toCreate.length - i);
      process.stdout.write(`\r  Created ${created}/${toCreate.length}`);
    }
    console.log('');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const byNetwork = {};
  for (const { doc } of toCreate) byNetwork[doc.network] = (byNetwork[doc.network] || 0) + 1;
  const assignedCount = toCreate.filter((e) => e.doc.assigned).length;

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(dryRun ? '  SUMMARY (dry run — no writes performed)' : '  SUMMARY');
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(`  Accounts ${dryRun ? 'to create' : 'created  '}          : ${toCreate.length}`);
  for (const [network, count] of Object.entries(byNetwork)) {
    console.log(`    ${network.padEnd(12)}            : ${count}`);
  }
  console.log(`  Matched to a user (assigned): ${assignedCount}`);
  console.log(`  Rows skipped                : ${skipped.length}`);
  console.log('══════════════════════════════════════════════════════════════════════');

  if (skipped.length > 0) {
    console.log(`\n── Skipped rows (${skipped.length}) ──────────────────────────────────────────`);
    for (const s of skipped) {
      console.log(`  [row ${s.row}] ${s.name || '(blank name)'}  —  ${s.reason}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n── Warnings — imported anyway (${warnings.length}) ──────────────────────────`);
    for (const w of warnings) {
      console.log(`  [row ${w.row}] ${w.name}  —  ${w.message}`);
    }
  }

  if (Object.keys(unmatchedAssignments).length > 0) {
    console.log(`\n── "assigned" names with no matching user (${Object.keys(unmatchedAssignments).length}) ──`);
    for (const [name, accounts] of Object.entries(unmatchedAssignments)) {
      console.log(`  "${name}"  →  ${[...accounts].join(', ')}`);
    }
  }

  if (Object.keys(ambiguousAssignments).length > 0) {
    console.log(`\n── "assigned" names matching more than one user (${Object.keys(ambiguousAssignments).length}) ──`);
    for (const [name, accounts] of Object.entries(ambiguousAssignments)) {
      console.log(`  "${name}"  →  ${[...accounts].join(', ')}  (${uidsByFirstName[name.toLowerCase()].length} users share this first name — left unassigned)`);
    }
  }

  console.log('\nDone!');
}

main().catch((err) => { console.error(err); process.exit(1); });
