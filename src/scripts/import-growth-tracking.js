'use strict';
// Run from the app root: cd src && node scripts/import-growth-tracking.js
// Add --dry-run to preview every change without writing anything.
// Add --wipe to delete every existing growth-accounts document (and its series
//   subtree) before importing — destructive, opt-in, honoured by --dry-run.
//
// Seeds `growth-accounts` from the two hand-collected sheets in the repo root:
//   "BLUU _ Central Growth Tracking _ 2026 - JULY.csv"
//   "BLUU _ Central Growth Tracking _ 2026 - AUGUST.csv"
//
// This is the history that existed before the nightly Apify scrape
// (/api/cron/growth-tracking) took over. It also creates the twelve account
// documents themselves, so a fresh database comes up fully configured.
//
// ── What the sheets actually are ────────────────────────────────────────────
// Working documents, typed by hand by two people (the "Josh"/"Saad" rows are
// their sign-off times, not data). They carry dozens of dead rows for accounts
// nobody ever filled in, a "GROWTH" summary column, Instagram and group
// sections, and both Followers and Engagement lines for the Facebook pages.
// Only the twelve accounts in ACCOUNTS below are imported.
//
// ── Structure, and the one trap in it ───────────────────────────────────────
// Row 1 is the date header ("DATE >", then 1st … 31st). Column 3 is the row
// label. Facebook rows are labelled "<Name> (Followers)"; Twitter rows are a
// bare handle whose value IS the follower count.
//
// THE TRAP: the day columns sit at a DIFFERENT OFFSET in each file. JULY puts
// "1st" at index 4; AUGUST has an extra carry-over column and puts it at 5. So
// the day columns are located by matching the ordinal strings in row 1, never by
// a fixed offset. Verified against both files.
//
// A second trap: "TwinkUniversity" appears twice — once as an empty Facebook
// page row (JULY line 31, labelled "TwinkUniversity (Followers)") and once as
// the real Twitter row (line 89). Rows are therefore matched inside their
// platform section, delimited by the FACEBOOK / INSTAGRAM / TWITTER markers in
// column 0, rather than by label alone.
//
// ── What is NOT imported, and why ───────────────────────────────────────────
// The Facebook "(Engagement)" rows. The Apify actor cannot produce that metric,
// so importing it would create a series that stops dead on the day automation
// took over — a chart that appears to show engagement collapsing to nothing.
// Followers is the only metric that survives the handover.
//
// Blank cells are missed days (mostly weekends) and are SKIPPED, not written as
// zero: a zero would draw a cliff to the axis and read as "this page lost all
// its followers". A literal 0 in a data column is a sheet placeholder and is
// treated the same way.
//
// ── Idempotency ─────────────────────────────────────────────────────────────
// Document ids are deterministic (`<platform>_<lowercased handle>`, the same id
// the app builds via growthAccountId) and every write is a merge, so a re-run
// rewrites the same documents rather than duplicating anything. The account doc
// is only created if absent — a re-run never clobbers a display name or an
// isActive flag someone has since changed in the UI.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DRY_RUN = process.argv.includes('--dry-run');
const WIPE = process.argv.includes('--wipe');

const REPO_ROOT = path.join(__dirname, '../..');
const SHEETS = [
  { file: 'BLUU _ Central Growth Tracking _ 2026 - JULY.csv', year: 2026, month: 7 },
  { file: 'BLUU _ Central Growth Tracking _ 2026 - AUGUST.csv', year: 2026, month: 8 },
];

/**
 * The twelve accounts to import, and the seed for their account documents.
 * `label` is the exact string in column 3 of the sheet, inside that platform's
 * section. URLs are as supplied in GROWTH_TRACKING.md — note the deliberate mix
 * of http/https, x.com/twitter.com and www., all of which normalize to one
 * canonical form (mirrored from src/lib/growth/platform.ts below).
 */
const ACCOUNTS = [
  { platform: 'facebook', label: 'Adam (Followers)',        name: 'Adam',            url: 'https://www.facebook.com/adamtwinkx' },
  { platform: 'facebook', label: 'Cole (Followers)',        name: 'Cole',            url: 'https://www.facebook.com/xColeBentley' },
  { platform: 'facebook', label: 'Connor (Followers)',      name: 'Connor',          url: 'https://www.facebook.com/connorsfacebook/' },
  { platform: 'facebook', label: 'Leo (Followers)',         name: 'Leo',             url: 'https://www.facebook.com/LeoTwxnk/' },
  { platform: 'facebook', label: 'Noah Ryder (Followers)',  name: 'Noah Ryder',      url: 'https://www.facebook.com/NoahRyderXX' },
  { platform: 'twitter',  label: 'TwinkUniversity',         name: 'TwinkUniversity', url: 'https://x.com/TwinkUniversity' },
  { platform: 'twitter',  label: 'TwinkLoad',               name: 'TwinkLoad',       url: 'http://twitter.com/TwinkLoad' },
  { platform: 'twitter',  label: 'TwinkPublic',             name: 'TwinkPublic',     url: 'http://twitter.com/TwinkPublic' },
  { platform: 'twitter',  label: 'TwinkKinkz',              name: 'TwinkKinkz',      url: 'http://x.com/twinkkinkz' },
  { platform: 'twitter',  label: 'TwinkToons',              name: 'TwinkToons',      url: 'http://www.twitter.com/TwinkToons' },
  { platform: 'twitter',  label: 'TwinkDong',               name: 'TwinkDong',       url: 'http://twitter.com/TwinkDong' },
  { platform: 'twitter',  label: 'TwinkCheeks',             name: 'TwinkCheeks',     url: 'http://twitter.com/TwinkCheeks' },
];

const GROWTH_ACCOUNTS = 'growth-accounts';
const SERIES_SUB = 'series';

// ─── Identity ──────────────────────────────────────────────────────────────
// Hand-copied mirror of parseProfileUrl/growthAccountId in
// src/lib/growth/platform.ts (a .js script cannot import the TS module).
// KEEP THE TWO IN LOCKSTEP — a divergence here writes history under document
// ids the app will never look up, and the import silently appears to do nothing.

function parseProfileUrl(platform, input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let handle;
  if (!raw.includes('/') && !raw.includes('.')) {
    handle = raw.replace(/^@/, '');
  } else {
    let url;
    try {
      url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    const segment = url.pathname.split('/').filter(Boolean)[0];
    if (!segment) return null;
    handle = decodeURIComponent(segment).replace(/^@/, '');
  }
  const pattern = platform === 'facebook' ? /^[A-Za-z0-9.]{3,60}$/ : /^[A-Za-z0-9_]{1,15}$/;
  if (!pattern.test(handle)) return null;
  return {
    handle,
    handleNormalized: handle.toLowerCase(),
    canonicalUrl: platform === 'facebook'
      ? `https://www.facebook.com/${handle}`
      : `https://x.com/${handle}`,
  };
}

const growthAccountId = (platform, handleNormalized) => `${platform}_${handleNormalized}`;

// ─── CSV ───────────────────────────────────────────────────────────────────

/** Minimal RFC-4180 reader: quoted fields, doubled quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Day number → column index, read from the ordinal strings in the header row. */
function dayColumns(headerRow) {
  const byDay = {};
  headerRow.forEach((cell, i) => {
    const m = /^(\d{1,2})(st|nd|rd|th)$/.exec(String(cell).trim());
    if (m) byDay[Number(m[1])] = i;
  });
  return byDay;
}

/**
 * "32,101" → 32101. Blanks, placeholders and a literal 0 all return null: they
 * mean "not recorded", and writing a 0 for them would fabricate a collapse.
 */
function parseCount(cell) {
  const raw = String(cell ?? '').trim().replace(/,/g, '');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** Which platform section a row falls in, from the FACEBOOK/INSTAGRAM/TWITTER markers in column 0. */
function sectionFor(rows, rowIndex) {
  let section = null;
  for (let i = 0; i <= rowIndex; i++) {
    const marker = String(rows[i][0] ?? '').trim().toUpperCase();
    if (marker === 'FACEBOOK') section = 'facebook';
    else if (marker === 'TWITTER') section = 'twitter';
    else if (marker === 'INSTAGRAM') section = 'instagram';
  }
  return section;
}

/** All readings in one sheet: Map<label+platform, Map<dayKey, followers>>. */
function readSheet({ file, year, month }) {
  const rows = parseCsv(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  const columns = dayColumns(rows[0] ?? []);
  const found = new Map();

  for (const account of ACCOUNTS) {
    const rowIndex = rows.findIndex((r, i) =>
      String(r[3] ?? '').trim() === account.label && sectionFor(rows, i) === account.platform);
    if (rowIndex === -1) {
      console.warn(`  ! ${file}: no "${account.label}" row in the ${account.platform} section`);
      continue;
    }

    const readings = new Map();
    for (const [day, column] of Object.entries(columns)) {
      const followers = parseCount(rows[rowIndex][column]);
      if (followers === null) continue;
      const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      readings.set(dayKey, followers);
    }
    found.set(`${account.platform}:${account.label}`, readings);
  }

  return found;
}

// ─── Firebase ──────────────────────────────────────────────────────────────

let db;
function initFirebase() {
  const envPath = path.join(__dirname, '../.env.local');
  const envLines = fs.readFileSync(envPath, 'utf8')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // Same reader the other import scripts use — deliberately NOT trimming or
  // unquoting, because FIREBASE_SERVICE_ACCOUNT is raw JSON on one line.
  for (const line of envLines) {
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      if (key) process.env[key] = line.slice(eqIdx + 1);
    }
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
  db = admin.firestore();
}

async function wipe() {
  const snap = await db.collection(GROWTH_ACCOUNTS).get();
  console.log(`--wipe: deleting ${snap.size} account document(s) and their series`);
  if (DRY_RUN) return;
  for (const doc of snap.docs) await db.recursiveDelete(doc.ref);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — nothing will be written\n' : 'Importing…\n');

  // Merge both sheets before touching Firestore, so a parse failure in the
  // second file cannot leave a half-imported history behind.
  const merged = new Map();
  for (const sheet of SHEETS) {
    console.log(`Reading ${sheet.file}`);
    const readings = readSheet(sheet);
    for (const [key, days] of readings) {
      if (!merged.has(key)) merged.set(key, new Map());
      const target = merged.get(key);
      for (const [dayKey, followers] of days) target.set(dayKey, followers);
    }
  }
  console.log('');

  initFirebase();
  if (WIPE) await wipe();

  let totalReadings = 0;

  for (const account of ACCOUNTS) {
    const parsed = parseProfileUrl(account.platform, account.url);
    if (!parsed) {
      console.error(`  ✗ ${account.name}: unparseable URL "${account.url}" — skipped`);
      continue;
    }

    const id = growthAccountId(account.platform, parsed.handleNormalized);
    const readings = merged.get(`${account.platform}:${account.label}`) ?? new Map();
    const dayKeys = [...readings.keys()].sort();

    if (dayKeys.length === 0) {
      console.warn(`  ! ${account.name} (${id}): no readings found in either sheet`);
    }

    // Group by year — one series document per account per year.
    const byYear = {};
    for (const dayKey of dayKeys) {
      const year = dayKey.slice(0, 4);
      (byYear[year] ??= {})[dayKey] = { followers: readings.get(dayKey) };
    }

    const latestKey = dayKeys[dayKeys.length - 1];
    const previousKey = dayKeys[dayKeys.length - 2];

    console.log(
      `  ${account.name.padEnd(16)} ${id.padEnd(28)} ` +
      `${String(dayKeys.length).padStart(2)} readings` +
      (latestKey ? ` · ${dayKeys[0]} → ${latestKey} · ${readings.get(latestKey).toLocaleString('en-US')}` : ''),
    );
    totalReadings += dayKeys.length;

    if (DRY_RUN) continue;

    const ref = db.collection(GROWTH_ACCOUNTS).doc(id);
    const existing = await ref.get();

    if (!existing.exists) {
      await ref.set({
        platform: account.platform,
        displayName: account.name,
        handle: parsed.handle,
        handleNormalized: parsed.handleNormalized,
        profileUrl: parsed.canonicalUrl,
        isActive: true,
        profilePictureUrl: null,
        isVerified: false,
        // Seeded from the sheet. The first nightly scrape overwrites `latest`
        // and shifts this into `previous`, exactly as any other night would.
        latest: latestKey ? { followers: readings.get(latestKey), date: latestKey } : null,
        previous: previousKey ? { followers: readings.get(previousKey), date: previousKey } : null,
        // Never scraped yet — deliberately null rather than a fake timestamp, so
        // the page's staleness check has nothing to misread.
        lastScrapeAt: null,
        lastScrapeStatus: null,
        lastScrapeError: null,
        addedBy: 'import-growth-tracking',
        addedTime: FieldValue.serverTimestamp(),
      });
    } else {
      // A re-run must not clobber a display name or isActive flag changed in the
      // UI since. Only the history is authoritative here.
      console.log('    (account document already exists — history only)');
    }

    for (const [year, days] of Object.entries(byYear)) {
      await ref.collection(SERIES_SUB).doc(year).set({ days }, { merge: true });
    }
  }

  console.log(`\n${DRY_RUN ? 'Would import' : 'Imported'} ${totalReadings} readings across ${ACCOUNTS.length} accounts.`);
  if (!DRY_RUN) {
    console.log('The nightly cron (/api/cron/growth-tracking) takes over from tonight.');
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
