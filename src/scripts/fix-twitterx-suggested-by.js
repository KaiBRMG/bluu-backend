'use strict';
// Run from the app root: cd src && node scripts/fix-twitterx-suggested-by.js --dry-run
//
// One-off backfill for `twitterx-accounts`.suggestedBy — the SMM whose approved
// page suggestion added a viral page. That uid is what earns the $2
// page-suggestion share (rule 3️⃣) every time another SMM copies content from
// the page, so it must be right before the next bonus round is submitted.
//
// NOTE ON THE FIELD NAME. The sheet calls this column "submittedBy" because it
// comes from the suggestion's `submittedBy`. On the ACCOUNT the field is
// `suggestedBy` (`twitterx-page-suggestions.submittedBy` → `accounts.suggestedBy`
// at approval time). This script writes `suggestedBy`; there is no `submittedBy`
// field on an account.
//
// This script IMPORTS NOTHING. It never creates an account and never touches
// any field other than `suggestedBy` (+ `lastUpdatedTime` on docs it changes).
// In particular it does NOT set `isViralBonus` — a page that is not already
// flagged viral stays un-flagged, and is reported so it can be reviewed.
//
//   1. Reads the sheet (tab- or comma-delimited, no header) and resolves its
//      SMM column through NAME_MAP to a single uid.
//   2. Resolves each row's LINK to an account: the handle is taken from the
//      link (`extractAccountHandle`) and matched against each account's own
//      handle — read from `accountLink`, falling back to `accountName`, exactly
//      as `accountHandle()` does in the app. The link is matched, not the
//      display name, because a hand-typed `accountName` can drift from it.
//   3. Writes only the docs whose `suggestedBy` actually differs.
//
// Safety: if any SMM name fails to resolve to exactly one user, or any row's
// link fails to resolve to exactly one account, the script prints the offenders
// and REFUSES to write. Fix NAME_MAP (or the sheet), or pass --force to write
// the rows that DID resolve and skip the rest.
//
// Flags: --dry-run       preview every change, write nothing
//        --force         write the resolvable rows even if some rows failed
//        --csv=<path>    override the sheet location

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const ACCOUNTS = 'twitterx-accounts';
const BATCH_SIZE = 400;

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const csvArg = process.argv.find((a) => a.startsWith('--csv='));
const CSV_PATH = csvArg
  ? path.resolve(csvArg.slice('--csv='.length))
  : path.join(__dirname, '../../submittedBy.csv');

// The sheet's short SMM names → the `displayName` on the user doc.
const NAME_MAP = {
  SHALIE: 'Shalie Villalon',
  JEREZA: 'Jereza Pagobo',
  HANAH: 'Hanah Hatamosa',
};

// ─── Pure helpers (mirrors of src/lib/smm/linkUtils.ts) ───────────────────────

/** Mirror of `extractAccountHandle` — the first path segment of an x.com URL. */
function extractAccountHandle(url) {
  const link = (url || '').trim();
  if (!link) return '';
  const match = link.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i);
  const handle = match?.[1] ?? '';
  if (!handle || /^(i|home|search|explore|notifications|messages|settings)$/i.test(handle)) return '';
  return handle.replace(/^@/, '');
}

/** Mirror of `accountHandle` — the link wins, the name is only the fallback. */
function accountHandle(account) {
  return (
    extractAccountHandle(account.accountLink ?? '')
    || (account.accountName ?? '').trim().replace(/^@/, '')
  );
}

/**
 * Delimiter-aware parser for the sheet: tab if the first line has one (the
 * export is TSV despite the .csv name), comma otherwise. Handles quoted cells
 * and CRLF.
 */
function parseDelimited(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delim = clean.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => (c || '').trim() !== ''));
}

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

  // ── Users → uid by display name ──────────────────────────────────────────
  console.log('Loading users...');
  const usersSnap = await db.collection('users').get();
  const uidsByName = {}; // lower-cased name → [uid, ...]
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
  }
  console.log(`  ${usersSnap.size} users loaded`);

  // Resolve NAME_MAP up front — a bad mapping is a config error, not a row error.
  const uidByShortName = {};
  const badNames = [];
  for (const [short, full] of Object.entries(NAME_MAP)) {
    const unique = [...new Set(uidsByName[full.toLowerCase()] || [])];
    if (unique.length === 1) {
      uidByShortName[short.toLowerCase()] = unique[0];
    } else {
      badNames.push(`"${short}" → "${full}" ${unique.length === 0
        ? 'matched no active user'
        : `matched ${unique.length} users (${unique.map((u) => nameByUid[u]).join(', ')})`}`);
    }
  }
  if (badNames.length > 0) {
    console.log('\n⚠  NAME_MAP could not be resolved:');
    for (const b of badNames) console.log(`   ${b}`);
    console.log('\nRefusing to continue — fix NAME_MAP in this script.');
    process.exit(1);
  }

  // ── Sheet ────────────────────────────────────────────────────────────────
  // No header. The link is the first cell holding an x.com/twitter.com URL and
  // the SMM is the last non-empty cell, so a stray/blank column can't shift the
  // mapping the way fixed indices would.
  console.log(`Parsing ${path.relative(process.cwd(), CSV_PATH)}...`);
  const rows = parseDelimited(fs.readFileSync(CSV_PATH, 'utf8'));

  const wanted = [];      // { row, label, handle, uid, smm }
  const rowProblems = []; // { row, message }
  const seenHandles = new Map(); // handle → row number of the first sighting

  rows.forEach((raw, idx) => {
    const rowNum = idx + 1;
    const cells = raw.map((c) => (c || '').trim());
    const label = cells[0] || '(unnamed)';

    const linkCell = cells.find((c) => /(?:x|twitter)\.com\//i.test(c)) || '';
    const handle = extractAccountHandle(linkCell).toLowerCase();
    if (!handle) {
      rowProblems.push({ row: rowNum, message: `${label}: no usable x.com link in the row` });
      return;
    }

    const nonEmpty = cells.filter(Boolean);
    const smm = nonEmpty[nonEmpty.length - 1] || '';
    const uid = uidByShortName[smm.toLowerCase()];
    if (!uid) {
      rowProblems.push({ row: rowNum, message: `${label}: SMM "${smm}" is not in NAME_MAP` });
      return;
    }

    const dupOf = seenHandles.get(handle);
    if (dupOf) {
      rowProblems.push({ row: rowNum, message: `${label}: @${handle} already claimed by row ${dupOf} — later row ignored` });
      return;
    }
    seenHandles.set(handle, rowNum);
    wanted.push({ row: rowNum, label, handle, uid, smm });
  });
  console.log(`  ${rows.length} rows read, ${wanted.length} usable`);

  // ── Accounts, indexed by handle ──────────────────────────────────────────
  // The handle is derived, so it can't be queried — the whole collection is
  // read once and indexed in memory. Acceptable for a one-off; do not copy this
  // pattern into the app.
  console.log('\nLoading twitterx-accounts...');
  const accountsSnap = await db.collection(ACCOUNTS).get();
  const byHandle = new Map(); // handle → [{ ref, data }, ...]
  for (const doc of accountsSnap.docs) {
    const data = doc.data();
    const handle = accountHandle(data).toLowerCase();
    if (!handle) continue;
    if (!byHandle.has(handle)) byHandle.set(handle, []);
    byHandle.get(handle).push({ ref: doc.ref, data });
  }
  console.log(`  ${accountsSnap.size} accounts loaded`);

  // ── Diff ─────────────────────────────────────────────────────────────────
  const changes = [];    // { ref, label, handle, from, to, notViral }
  const unmatched = [];  // rows whose handle is in no account
  const ambiguous = [];  // rows whose handle is on several accounts
  let unchanged = 0;

  for (const w of wanted) {
    const matches = byHandle.get(w.handle) || [];
    if (matches.length === 0) { unmatched.push(w); continue; }
    if (matches.length > 1) {
      ambiguous.push({ ...w, names: matches.map((m) => m.data.accountName || '(unnamed)') });
      continue;
    }
    const { ref, data } = matches[0];
    const from = data.suggestedBy ?? null;
    if (from === w.uid) { unchanged++; continue; }
    changes.push({
      ref,
      label: data.accountName || w.label,
      handle: w.handle,
      from,
      to: w.uid,
      notViral: data.isViralBonus !== true,
    });
  }

  const blocked = rowProblems.length + unmatched.length + ambiguous.length;
  if (blocked > 0 && !dryRun && !force) {
    console.log(`\n⚠  ${blocked} row(s) could not be applied — see the report below.`);
    console.log('Refusing to write. Fix the sheet/NAME_MAP, or re-run with --force');
    console.log('to write the rows that DID resolve and skip the rest.');
    report();
    process.exit(1);
  }

  // ── Write ────────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log(`\n[dry run] would update ${changes.length} accounts — no writes performed.`);
  } else if (changes.length > 0) {
    let done = 0;
    for (let i = 0; i < changes.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const c of changes.slice(i, i + BATCH_SIZE)) {
        batch.update(c.ref, { suggestedBy: c.to, lastUpdatedTime: FieldValue.serverTimestamp() });
      }
      await batch.commit();
      done += Math.min(BATCH_SIZE, changes.length - i);
      process.stdout.write(`\r  Updated ${done}/${changes.length}`);
    }
    console.log('');
  } else {
    console.log('\nNothing to change.');
  }

  report();

  function report() {
    const overwrites = changes.filter((c) => c.from);
    const notViral = changes.filter((c) => c.notViral);

    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log(dryRun ? '  SUMMARY (dry run — no writes performed)' : '  SUMMARY');
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log(`  Rows in the sheet            : ${rows.length}`);
    console.log(`  Accounts in Firestore        : ${accountsSnap.size}`);
    console.log(`  Accounts ${dryRun ? 'to change' : 'changed  '}          : ${changes.length}`);
    console.log(`    replacing a different uid  : ${overwrites.length}`);
    console.log(`  Already correct              : ${unchanged}`);
    console.log(`  Rows ignored (bad row)       : ${rowProblems.length}`);
    console.log(`  Rows with no account         : ${unmatched.length}`);
    console.log(`  Rows matching >1 account     : ${ambiguous.length}`);
    console.log('══════════════════════════════════════════════════════════════════════');

    if (changes.length > 0) {
      console.log(`\n── Changes (${changes.length}) ─────────────────────────────────────────`);
      for (const c of changes) {
        const fromLabel = c.from ? (nameByUid[c.from] || c.from) : '(none)';
        console.log(`  @${c.handle} — ${c.label}: ${fromLabel}  →  ${nameByUid[c.to] || c.to}`);
      }
    }

    // Not an error, but a page nobody may copy from pays no $2 share, so a
    // suggester on one is almost certainly worth a look.
    if (notViral.length > 0) {
      console.log(`\n── ⚠ Written, but NOT flagged isViralBonus (${notViral.length}) ────────────`);
      console.log('   These pages pay no page-suggestion share until an admin ticks');
      console.log('   "Viral account" on them (this script never sets that flag).');
      for (const c of notViral) console.log(`  @${c.handle} — ${c.label}`);
    }

    if (unmatched.length > 0) {
      console.log(`\n── Sheet rows with no matching account (${unmatched.length}) ────────────────`);
      for (const w of unmatched) console.log(`  [row ${w.row}] ${w.label}  —  @${w.handle} (${w.smm})`);
    }

    if (ambiguous.length > 0) {
      console.log(`\n── Sheet rows matching MORE THAN ONE account (${ambiguous.length}) ──────────`);
      for (const w of ambiguous) {
        console.log(`  [row ${w.row}] ${w.label}  —  @${w.handle} matches: ${w.names.join(', ')}`);
      }
    }

    if (rowProblems.length > 0) {
      console.log(`\n── Sheet rows ignored (${rowProblems.length}) ───────────────────────────`);
      for (const p of rowProblems) console.log(`  [row ${p.row}] ${p.message}`);
    }

    console.log('\nDone!');
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
