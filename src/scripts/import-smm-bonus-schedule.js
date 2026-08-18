'use strict';
// Run from the app root: cd src && node scripts/import-smm-bonus-schedule.js
// Add --dry-run to preview every change without writing anything.
// Add --wipe to delete EVERY existing post in twitterx-content-schedule first
//   (see "Wiping" below — destructive, opt-in, and honoured by --dry-run).
//
// Imports "SMM _ Bonus Scheme Tracking - CONTENTS.csv" (repo root) into
// twitterx-content-schedule/{accountId}/posts/{postId}.
//
// ── What the sheet's "POST LINK" column actually is ─────────────────────────
// It is NOT the SMM's own upload. Every link in it is the **original viral
// post that was copied** — the same thing an SMM types into ViralCopyDialog
// ("Did you copy another viral post?"). That is provable from the handles:
// they resolve to the viral pages seeded by import-twitterx-accounts.js
// (isViralBonus = true), never to the SMMs' own managed pages.
//
// So the sheet maps onto the copy declaration, not onto the post link:
//   SMM        → postedBy   (uid, resolved via SMM_NAME_MAP below; some SMMs
//                are deliberately left unassigned — see UNASSIGNED_SMMS)
//   POST LINK  → originalLink & originalLinkNormalized, isViralCopy: true,
//                and the resolved source account → originalAcc / sourceAcc /
//                sourceAccName — exactly what POST /api/smm/posts stores for a
//                declared copy.
//   DATE POSTED→ postDate, at 00:00 local time (the sheet has no time of day)
//
// `postLink`/`postLinkNormalized` are written EMPTY. The sheet never recorded
// the SMM's own upload URL, and inventing one would poison findDuplicatePostLink
// and findLinkUsage. Live posts created through the app always carry one; these
// historical rows simply cannot. Nothing breaks on '': both lookups short-circuit
// on an empty normalized link.
//
// ── Which account the post is written under ─────────────────────────────────
// The parent account is the **source (viral) account** resolved from the link
// — because it is the only account the sheet identifies. The page the SMM
// actually posted on is not recorded anywhere in the CSV, and guessing one of
// their assigned pages would fabricate the bonus tier. Consequence: for these
// seeded rows, parent accountId === originalAcc === sourceAcc. That is fine for
// the job this seed exists to do — the 2-week source rule is a collection-group
// query on originalLinkNormalized (findLinkUsage), so it is parent-independent.
// A handle not found in twitterx-accounts is a hard failure for that row —
// there is nowhere to write the post.
//
// ── Idempotency ─────────────────────────────────────────────────────────────
// Doc ids are deterministic — a hash of (SMM, normalized original link, date) —
// so re-running rewrites the same documents instead of duplicating them, and a
// row repeated verbatim inside the CSV collapses to one doc. Rows already
// present are reported as skipped rather than rewritten.
//
// ── Wiping ──────────────────────────────────────────────────────────────────
// --wipe deletes every doc under twitterx-content-schedule/{any}/posts before
// importing. Parent docs are never created, so the accounts are enumerated with
// listDocuments() (which returns refs for missing parents that have
// subcollections) rather than a collection-group query.
//
// Extra CSV columns (D/E/F) are sheet validation notes/examples, not data —
// only the first three columns (SMM, POST LINK, DATE POSTED) are read.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

// ─── .env.local ────────────────────────────────────────────────────────────
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

const CSV_PATH = path.join(__dirname, '../../SMM _ Bonus Scheme Tracking - CONTENTS.csv');
const SMM_ACCOUNTS = 'twitterx-accounts';
const SMM_SCHEDULE = 'twitterx-content-schedule';
const SMM_POSTS_SUB = 'posts';
const BATCH_SIZE = 400;
const dryRun = process.argv.includes('--dry-run');
const wipe = process.argv.includes('--wipe');

/**
 * Deterministic doc id for a row: the same row always lands on the same
 * document, so a re-run overwrites instead of duplicating. Keyed on the three
 * columns the sheet actually carries — the SMM, the copied original (normalized,
 * so URL variants collapse) and the date.
 */
function rowDocId(smmKey, originalNormalized, date) {
  const key = `${smmKey}|${originalNormalized}|${date.toISOString().slice(0, 10)}`;
  return `csv-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 24)}`;
}

/** Delete every doc under twitterx-content-schedule/{account}/posts. */
async function wipeSchedule() {
  const accountRefs = await db.collection(SMM_SCHEDULE).listDocuments();
  let found = 0;
  let deleted = 0;
  for (const accountRef of accountRefs) {
    const snap = await accountRef.collection(SMM_POSTS_SUB).select().get();
    found += snap.size;
    if (dryRun || snap.empty) continue;
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + BATCH_SIZE)) batch.delete(doc.ref);
      await batch.commit();
      deleted += Math.min(BATCH_SIZE, snap.docs.length - i);
    }
  }
  console.log(dryRun
    ? `  [dry run] would delete ${found} posts across ${accountRefs.length} accounts`
    : `  Deleted ${deleted} posts across ${accountRefs.length} accounts`);
}

// ─── CSV parser (quote-aware; the sheet's warning notes are multi-line
//     quoted cells in columns beyond the ones we read) ─────────────────────
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
        if (clean[i + 1] === '"') { field += '"'; i++; }
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

// ─── Link helpers (mirrors src/lib/smm/linkUtils.ts) ───────────────────────
function extractAccountHandle(url) {
  const link = (url || '').trim();
  if (!link) return '';
  const match = link.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i);
  const handle = match ? match[1] : '';
  if (!handle || /^(i|home|search|explore|notifications|messages|settings)$/i.test(handle)) return '';
  return handle.replace(/^@/, '');
}

// Keep in lockstep with normalizePostLink in src/lib/smm/linkUtils.ts — the
// identity is the tweet's status id, so every URL variant of the same post
// (scheme, www., x.com/twitter.com, handle, /photo/N, ?params) collapses to one
// value. Diverging here would import rows the app then can't match.
function normalizePostLink(url) {
  let link = (url || '').trim();
  if (!link) return '';
  link = link.split('#')[0].split('?')[0];

  const statusId = (link.match(/\/status(?:es)?\/(\d+)/i) || [])[1];
  if (statusId) return `x.com/i/status/${statusId}`;

  link = link.replace(/\/(photo|video)\/\d+\/?$/i, '');
  link = link.replace(/\/+$/, '');
  link = link.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const parts = link.split('/');
  parts[0] = parts[0].toLowerCase().replace(/^twitter\.com$/, 'x.com');
  return parts.join('/');
}

// ─── Date parser — the sheet has typos ("Novermber", "Febuary") and
//     inconsistent spacing ("October 8,2025"), so this is deliberately
//     forgiving rather than relying on Date.parse. ──────────────────────────
const MONTH_MAP = {
  january: 0, february: 1, febuary: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, novermber: 10,
  december: 11,
};

function parseDatePosted(raw) {
  const m = (raw || '').trim().match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (month === undefined) return null;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const date = new Date(year, month, day, 0, 0, 0, 0);
  if (date.getMonth() !== month || date.getDate() !== day) return null; // e.g. Feb 30
  return date;
}

// ─── SMM name mapping ───────────────────────────────────────────────────────
const SMM_NAME_MAP = {
  SHALIEE: 'Shalie Villalon',
  HANAH: 'Hanah Hatamosa',
  JEREZA: 'Jereza Pagobo',
  MERCY: 'Mercy Redilla',
};
// Deliberately left unassigned (no Firestore user to map to) — the row is
// still imported, just with postedBy left empty.
const UNASSIGNED_SMMS = new Set(['JAY', 'ANDREW', 'ROLAN', 'KERT']);

function nameKey(handle) {
  return (handle || '').trim().replace(/^@/, '').toLowerCase();
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  initFirebase();

  console.log('Loading users...');
  const usersSnap = await db.collection('users').get();
  const uidsByName = {}; // lowercase name (displayName or "First Last") → [uid, ...]
  const addName = (name, uid) => {
    const key = (name || '').trim().toLowerCase();
    if (!key) return;
    (uidsByName[key] = uidsByName[key] || []).push(uid);
  };
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    if (d.isArchived) continue;
    // displayName is often just a first name ("Shalie"); the mapping below
    // is given in "First Last" form, so index both.
    addName(d.displayName, doc.id);
    addName(`${d.firstName || ''} ${d.lastName || ''}`.trim(), doc.id);
  }
  console.log(`  ${usersSnap.size} users loaded`);

  console.log('Loading twitterx-accounts...');
  const accountsSnap = await db.collection(SMM_ACCOUNTS).get();
  const accountsByHandle = new Map(); // normalized accountName → { id, accountName, isViralBonus, status }
  for (const doc of accountsSnap.docs) {
    const d = doc.data();
    const key = nameKey(d.accountName);
    if (key && !accountsByHandle.has(key)) {
      accountsByHandle.set(key, {
        id: doc.id,
        accountName: d.accountName,
        isViralBonus: d.isViralBonus === true,
        status: d.status ?? 'active',
      });
    }
  }
  console.log(`  ${accountsSnap.size} accounts indexed`);

  if (wipe) {
    console.log('Wiping twitterx-content-schedule posts...');
    await wipeSchedule();
  }

  console.log('Parsing CSV...');
  const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  const header = rows.shift().map((h) => h.trim());
  if (header[0] !== 'SMM' || header[1] !== 'POST LINK' || header[2] !== 'DATE POSTED') {
    throw new Error(`Unexpected CSV header: ${header.join(', ')}`);
  }

  const failed = [];      // { row, name, reason } — not written
  const warnings = [];    // { row, name, message } — written anyway
  const candidates = [];  // rows that passed validation, pending dedup

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2; // 1-based, +1 for the header
    if (raw.every((cell) => (cell || '').trim() === '')) return; // blank line

    const smmRaw = (raw[0] || '').trim();
    // The sheet's "POST LINK" column is the copied ORIGINAL, not the SMM's own
    // upload — see the header comment.
    const originalLinkRaw = (raw[1] || '').trim();
    const datePostedRaw = (raw[2] || '').trim();
    const label = smmRaw || '(blank)';

    if (!smmRaw) {
      failed.push({ row: rowNum, name: label, reason: 'No SMM name' });
      return;
    }

    if (!originalLinkRaw || originalLinkRaw === '-') {
      failed.push({ row: rowNum, name: label, reason: `No original link (${originalLinkRaw ? `placeholder "${originalLinkRaw}"` : 'blank'})` });
      return;
    }

    const handle = extractAccountHandle(originalLinkRaw);
    if (!handle) {
      failed.push({ row: rowNum, name: label, reason: `Could not extract an X/Twitter handle from "${originalLinkRaw}"` });
      return;
    }

    // The account the copied original lives on — the post's source, resolved
    // exactly as resolveOriginalAccount does in the live app.
    const account = accountsByHandle.get(nameKey(handle));
    if (!account) {
      failed.push({ row: rowNum, name: label, reason: `Account "@${handle}" not found in twitterx-accounts` });
      return;
    }
    // Written anyway: these rows predate the flags, and the seed's job is to
    // record that the source was used, not to re-litigate whether it may be.
    if (!account.isViralBonus) {
      warnings.push({ row: rowNum, name: label, message: `Source "@${handle}" is not flagged isViralBonus — the live app would block this copy` });
    }
    if (account.status !== 'active') {
      warnings.push({ row: rowNum, name: label, message: `Source "@${handle}" is ${account.status} — the post will be hidden from dashboards (still counts for the 2-week rule)` });
    }

    const date = parseDatePosted(datePostedRaw);
    if (!date) {
      failed.push({ row: rowNum, name: label, reason: `Unparseable DATE POSTED "${datePostedRaw}"` });
      return;
    }

    // ── Resolve postedBy from the SMM column ──────────────────────────────
    const smmKey = smmRaw.toUpperCase();
    let postedBy = '';
    if (UNASSIGNED_SMMS.has(smmKey)) {
      warnings.push({ row: rowNum, name: label, message: `SMM "${smmRaw}" has no Firestore user mapping — postedBy left empty` });
    } else if (smmKey in SMM_NAME_MAP) {
      const displayName = SMM_NAME_MAP[smmKey];
      const unique = [...new Set(uidsByName[displayName.toLowerCase()] || [])];
      if (unique.length === 1) {
        postedBy = unique[0];
      } else {
        failed.push({
          row: rowNum,
          name: label,
          reason: unique.length === 0
            ? `SMM "${smmRaw}" maps to "${displayName}" but no such user exists`
            : `SMM "${smmRaw}" maps to "${displayName}" but ${unique.length} users matched`,
        });
        return;
      }
    } else {
      failed.push({ row: rowNum, name: label, reason: `Unrecognised SMM name "${smmRaw}" (not in the mapping)` });
      return;
    }

    const originalLinkNormalized = normalizePostLink(originalLinkRaw);
    candidates.push({
      row: rowNum,
      name: label,
      docId: rowDocId(smmKey, originalLinkNormalized, date),
      accountId: account.id,
      accountName: account.accountName,
      originalLink: originalLinkRaw,
      originalLinkNormalized,
      postedBy,
      postDate: date,
    });
  });

  // ── Dedup against Firestore (existing posts) and within the CSV itself ──
  // The doc id IS the row's identity (see rowDocId), so both questions are the
  // same one: does that id already exist?
  console.log('Checking for already-imported posts...');
  const uniqueAccountIds = [...new Set(candidates.map((c) => c.accountId))];
  const existingByAccount = new Map(); // accountId → Set(docId)
  for (const accountId of uniqueAccountIds) {
    const snap = await db
      .collection(SMM_SCHEDULE).doc(accountId).collection(SMM_POSTS_SUB)
      .select()
      .get();
    existingByAccount.set(accountId, new Set(snap.docs.map((d) => d.id)));
  }

  const skippedDuplicate = []; // { row, name, reason }
  const toWrite = [];
  for (const c of candidates) {
    const seen = existingByAccount.get(c.accountId);
    if (seen.has(c.docId)) {
      skippedDuplicate.push({ row: c.row, name: c.name, reason: `Already imported under ${c.accountName} (same SMM, original link and date)` });
      continue;
    }
    seen.add(c.docId); // catches a repeat later in the same CSV
    toWrite.push(c);
  }

  // ── Write ────────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log(`\n[dry run] would write ${toWrite.length} posts — no writes performed.`);
  } else {
    let written = 0;
    for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const c of toWrite.slice(i, i + BATCH_SIZE)) {
        const ref = db.collection(SMM_SCHEDULE).doc(c.accountId).collection(SMM_POSTS_SUB).doc(c.docId);
        batch.set(ref, {
          caption: '',
          accountName: c.accountName,
          postDate: Timestamp.fromDate(c.postDate),
          // The sheet never recorded the SMM's own upload — deliberately empty.
          postLink: '',
          postLinkNormalized: '',
          postedBy: c.postedBy,
          createdTime: FieldValue.serverTimestamp(),
          bonusSubmission: false,
          // Every row IS a viral copy: the link is the original that was copied.
          isViralCopy: true,
          originalLink: c.originalLink,
          originalLinkNormalized: c.originalLinkNormalized,
          originalAcc: c.accountId,
          sourceAcc: c.accountId,
          sourceAccName: c.accountName,
        });
      }
      await batch.commit();
      written += Math.min(BATCH_SIZE, toWrite.length - i);
      process.stdout.write(`\r  Written ${written}/${toWrite.length}`);
    }
    console.log('');
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const unassignedCount = toWrite.filter((c) => !c.postedBy).length;

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(dryRun ? '  SUMMARY (dry run — no writes performed)' : '  SUMMARY');
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(`  Rows parsed                 : ${rows.length}`);
  console.log(`  Posts ${dryRun ? 'to write' : 'written '}          : ${toWrite.length}`);
  console.log(`    with no postedBy (unmapped SMM) : ${unassignedCount}`);
  console.log(`  Skipped — already imported   : ${skippedDuplicate.length}`);
  console.log(`  Failed — not written          : ${failed.length}`);
  console.log(`  Warnings                     : ${warnings.length}`);
  console.log('══════════════════════════════════════════════════════════════════════');

  if (skippedDuplicate.length > 0) {
    console.log(`\n── Skipped — already imported (${skippedDuplicate.length}) ─────────────────────`);
    for (const s of skippedDuplicate) console.log(`  [row ${s.row}] ${s.name}  —  ${s.reason}`);
  }

  if (failed.length > 0) {
    console.log(`\n── Failed rows — NOT written (${failed.length}) ────────────────────────`);
    for (const f of failed) console.log(`  [row ${f.row}] ${f.name}  —  ${f.reason}`);
  }

  if (warnings.length > 0) {
    console.log(`\n── Warnings — written anyway (${warnings.length}) ──────────────────────`);
    for (const w of warnings) console.log(`  [row ${w.row}] ${w.name}  —  ${w.message}`);
  }

  console.log('\nDone!');
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

// Exported for offline testing of the pure parsing helpers.
module.exports = { parseCSV, extractAccountHandle, normalizePostLink, parseDatePosted, nameKey, rowDocId, SMM_NAME_MAP, UNASSIGNED_SMMS, CSV_PATH };
