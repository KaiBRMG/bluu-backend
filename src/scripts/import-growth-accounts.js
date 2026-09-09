'use strict';
// Run from the app root: cd src && node scripts/import-growth-accounts.js
// Add --dry-run to preview every change without writing anything.
// Add --file=<path> to read a roster other than the default accounts.txt.
//
// Loads the managed roster in `accounts.txt` (repo root) into `growth-accounts`
// and files each account under the category it is listed beneath. This is the
// bulk sibling of the Track Account dialog; the historical importer next door
// (import-growth-tracking.js) is a different job — it carries the two months of
// hand-typed follower history, and nothing here touches a series document.
//
// ── The file format ─────────────────────────────────────────────────────────
//   Category: TWXNK
//   - 💌 TWINKLOAD: http://twitter.com/TwinkLoad
//
// The label before the colon is IGNORED. It is a nickname typed by hand, often
// upper-cased and emoji-prefixed, and it is not the account's name in this
// subsystem — an account is named by its handle and nothing else. The handle is
// extracted from the URL, which is the only authoritative field in the line.
//
// ── What this WILL NOT do ───────────────────────────────────────────────────
// 1. It never overwrites tracked data. An account that already exists gets ONE
//    field written — `category` — via a merge. `latest`, `previous`, `isActive`,
//    `trackPosts`, the scrape stamps and the whole `series` subtree are left
//    exactly as they are. Roughly a dozen of the accounts in the file are
//    already tracked and carry two months of hand-collected history; losing that
//    is unrecoverable, because the scrapers only ever return TODAY's number.
// 2. It never calls Apify. The add-one-account route validates a URL with a live
//    scrape because a typo would otherwise bill every night forever; a bulk
//    import of ~60 accounts would be ~60 billed profile reads to learn the same
//    thing the nightly cron learns for free tonight. A new account therefore
//    starts with no reading at all (`latest: null`, "First reading tonight"),
//    and a handle that does not resolve shows up as a `failed` scrape status in
//    Manage Accounts on the first run — visible, and costing one night.
//
// ── Cost ────────────────────────────────────────────────────────────────────
// Every account added here is a permanent line on the nightly bill: $0.004 per X
// profile, $0.010 per Facebook page, every night, forever. The script prints the
// projected nightly and monthly figure and refuses to exceed
// MAX_TRACKED_ACCOUNTS (mirrored below — keep it in step with
// src/lib/services/growthTrackingService.ts).
//
// ── Idempotency ─────────────────────────────────────────────────────────────
// Document ids are deterministic (`<platform>_<lowercased handle>`), so a re-run
// re-files the same documents rather than duplicating anything, and re-running
// after editing a category in the file is how a category is corrected in bulk.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DRY_RUN = process.argv.includes('--dry-run');
const FILE_ARG = process.argv.find((a) => a.startsWith('--file='));

const REPO_ROOT = path.join(__dirname, '../..');
const ROSTER_FILE = FILE_ARG
  ? path.resolve(FILE_ARG.slice('--file='.length))
  : path.join(REPO_ROOT, 'accounts.txt');

const GROWTH_ACCOUNTS = 'growth-accounts';

/** Mirror of MAX_TRACKED_ACCOUNTS in growthTrackingService.ts. */
const MAX_TRACKED_ACCOUNTS = 100;

/** Mirror of UNIT_COST in growthTrackingService.ts — per account, per night. */
const UNIT_COST = { facebook: 0.01, twitter: 0.004 };

/**
 * Mirror of GROWTH_CATEGORIES and CATEGORIES_BY_PLATFORM in
 * src/lib/growth/category.ts. KEEP IN LOCKSTEP.
 *
 * The vocabulary is **platform-scoped**: TWXNK / BONUS / SFW REPOST describe how
 * the X roster is run and mean nothing on a Facebook page, which is GENERAL or
 * CREATOR. CREATOR is shared by both on purpose — a creator's X account and that
 * same creator's Facebook page are one grouping seen twice.
 *
 * So a heading in the roster file is not enough on its own: a Facebook URL
 * listed under `Category: TWXNK` is a mistake in the file, and it is reported
 * and skipped rather than written. The app's own POST route refuses the same
 * combination, and a bulk import must not be the one path around it.
 */
const CATEGORIES = ['TWXNK', 'BONUS', 'CREATOR', 'SFW REPOST', 'GENERAL'];
const CATEGORIES_BY_PLATFORM = {
  twitter: ['TWXNK', 'BONUS', 'CREATOR', 'SFW REPOST'],
  facebook: ['GENERAL', 'CREATOR'],
};

// ─── Identity ──────────────────────────────────────────────────────────────
// Hand-copied mirror of parseProfileUrl/growthAccountId in
// src/lib/growth/platform.ts (a .js script cannot import the TS module).
// KEEP THE TWO IN LOCKSTEP — a divergence here writes accounts under document
// ids the app never looks up, so the import appears to do nothing.

const HOSTS = {
  facebook: ['facebook.com', 'fb.com', 'm.facebook.com', 'web.facebook.com'],
  twitter: ['x.com', 'twitter.com', 'mobile.twitter.com'],
};

const RESERVED_SEGMENTS = new Set([
  'i', 'home', 'search', 'explore', 'settings', 'notifications', 'messages',
  'profile.php', 'pages', 'groups', 'events', 'watch', 'marketplace', 'people',
  'sharer', 'login', 'signup', 'privacy', 'help', 'about',
]);

/** Which platform a URL belongs to, or null if it is neither of ours. */
function platformFor(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const [platform, hosts] of Object.entries(HOSTS)) {
    if (hosts.includes(host)) return platform;
  }
  return null;
}

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
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!HOSTS[platform].includes(host)) return null;
    const segment = url.pathname.split('/').filter(Boolean)[0];
    if (!segment) return null;
    handle = decodeURIComponent(segment).replace(/^@/, '');
  }
  if (RESERVED_SEGMENTS.has(handle.toLowerCase())) return null;
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

// ─── The roster file ───────────────────────────────────────────────────────

/**
 * Parse accounts.txt into `{ platform, handle, handleNormalized, canonicalUrl,
 * category }` records.
 *
 * Everything that is not a `Category:` heading or a line carrying a URL is
 * ignored, so the file can keep its blank lines and stray code fence. A line
 * under no heading, or under an unrecognised one, is reported rather than filed
 * under a category the app does not know — the category vocabulary is closed,
 * and that is what makes its colours mean something on the page.
 */
function readRoster(file) {
  const text = fs.readFileSync(file, 'utf8');
  const records = [];
  const problems = [];
  let category = null;

  text.split(/\r?\n/).forEach((line, i) => {
    const lineNo = i + 1;
    const heading = /^\s*Category:\s*(.+?)\s*$/i.exec(line);
    if (heading) {
      const name = heading[1].trim().replace(/\s+/g, ' ').toUpperCase();
      if (!CATEGORIES.includes(name)) {
        problems.push(`line ${lineNo}: unknown category "${heading[1].trim()}" — accounts under it are skipped`);
        category = null;
      } else {
        category = name;
      }
      return;
    }

    // The URL is the only authoritative field on the line; the label before it
    // is a hand-typed nickname and is deliberately discarded.
    const url = /(https?:\/\/\S+|(?:www\.)?(?:x|twitter|facebook)\.com\/\S+)/i.exec(line);
    if (!url) return;

    const rawUrl = url[1].replace(/[.,;)]+$/, '');
    if (!category) {
      problems.push(`line ${lineNo}: ${rawUrl} sits under no known category — skipped`);
      return;
    }

    const platform = platformFor(rawUrl);
    if (!platform) {
      problems.push(`line ${lineNo}: ${rawUrl} is not a Facebook or X profile — skipped`);
      return;
    }

    const parsed = parseProfileUrl(platform, rawUrl);
    if (!parsed) {
      problems.push(`line ${lineNo}: could not read a handle out of ${rawUrl} — skipped`);
      return;
    }

    // The heading said a category this platform cannot hold. Skipped rather than
    // coerced: guessing which grouping was meant is how a creator's page ends up
    // filed as general, and the file is the thing that needs correcting.
    if (!CATEGORIES_BY_PLATFORM[platform].includes(category)) {
      problems.push(
        `line ${lineNo}: ${rawUrl} is a ${platform === 'facebook' ? 'Facebook' : 'X'} account but sits under ` +
        `"${category}", which only applies to ${platform === 'facebook' ? 'X' : 'Facebook'} — skipped ` +
        `(${platform} takes ${CATEGORIES_BY_PLATFORM[platform].join(' or ')})`,
      );
      return;
    }

    records.push({ platform, category, ...parsed });
  });

  // Two lines pointing at one account is a duplicate in the file, not two
  // accounts: the id is deterministic, so the second would silently overwrite
  // the first's category. Reported, and the first listing wins.
  const seen = new Map();
  const unique = [];
  for (const record of records) {
    const id = growthAccountId(record.platform, record.handleNormalized);
    if (seen.has(id)) {
      problems.push(`duplicate: ${id} is listed under both ${seen.get(id)} and ${record.category} — kept ${seen.get(id)}`);
      continue;
    }
    seen.set(id, record.category);
    unique.push({ id, ...record });
  }

  return { records: unique, problems };
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

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — nothing will be written\n' : 'Importing…\n');
  console.log(`Reading ${ROSTER_FILE}`);

  const { records, problems } = readRoster(ROSTER_FILE);
  for (const problem of problems) console.warn(`  ! ${problem}`);

  const byCategory = {};
  for (const r of records) (byCategory[r.category] ??= []).push(r);
  console.log(`\n${records.length} account(s) in the file:`);
  for (const category of CATEGORIES) {
    if (byCategory[category]) console.log(`  ${category.padEnd(12)} ${byCategory[category].length}`);
  }

  initFirebase();

  // One read per account, by id — the ids are deterministic, so this needs no
  // query, and `getAll` makes it a single round trip (rule 9).
  const refs = records.map((r) => db.collection(GROWTH_ACCOUNTS).doc(r.id));
  const existingDocs = refs.length > 0 ? await db.getAll(...refs) : [];
  const existing = new Set(existingDocs.filter((d) => d.exists).map((d) => d.id));

  const created = records.filter((r) => !existing.has(r.id));
  const refiled = records.filter((r) => existing.has(r.id));

  // The roster after this import, not just what the file adds: accounts already
  // tracked but absent from the file still cost money every night.
  const totalAfter = (await db.collection(GROWTH_ACCOUNTS).count().get()).data().count + created.length;
  const nightly = records.reduce((sum, r) => sum + UNIT_COST[r.platform], 0);

  console.log(
    `\n${created.length} to create · ${refiled.length} already tracked (category only)` +
    `\nRoster after this import: ${totalAfter} account(s), limit ${MAX_TRACKED_ACCOUNTS}` +
    `\nThese ${records.length} accounts cost ~$${nightly.toFixed(3)}/night, ~$${(nightly * 30.4).toFixed(2)}/month, forever.\n`,
  );

  if (totalAfter > MAX_TRACKED_ACCOUNTS) {
    console.error(
      `REFUSED: this import would take the roster to ${totalAfter}, past the ` +
      `MAX_TRACKED_ACCOUNTS breaker of ${MAX_TRACKED_ACCOUNTS}. Past that the nightly cron ` +
      `scrapes NOTHING at all, so importing anyway would stop the whole job. Raise the limit ` +
      `in src/lib/services/growthTrackingService.ts (and here) deliberately, with the bill above ` +
      `in mind — never to clear this error.`,
    );
    process.exitCode = 1;
    return;
  }

  for (const record of records) {
    const isNew = !existing.has(record.id);
    console.log(
      `  ${isNew ? '+' : '·'} ${record.handle.padEnd(18)} ${record.id.padEnd(30)} ${record.category}` +
      (isNew ? '' : ' (category only — history untouched)'),
    );

    if (DRY_RUN) continue;

    const ref = db.collection(GROWTH_ACCOUNTS).doc(record.id);

    if (isNew) {
      await ref.set({
        platform: record.platform,
        handle: record.handle,
        handleNormalized: record.handleNormalized,
        profileUrl: record.canonicalUrl,
        category: record.category,
        // The scrapers report the platform's own account id; nothing here can
        // know it without paying for a read, so it arrives on the first scrape.
        platformAccountId: null,
        isActive: true,
        profilePictureUrl: null,
        isVerified: false,
        // No reading yet — deliberately null rather than a zero, which would
        // draw a cliff to the axis. The nightly cron takes the first one.
        latest: null,
        previous: null,
        lastScrapeAt: null,
        lastScrapeStatus: null,
        lastScrapeError: null,
        trackPosts: false,
        addedBy: 'import-growth-accounts',
        addedTime: FieldValue.serverTimestamp(),
      });
    } else {
      // THE ONE FIELD. A merge of anything else here would overwrite readings
      // that cannot be collected again.
      await ref.set({ category: record.category }, { merge: true });
    }
  }

  console.log(
    `\n${DRY_RUN ? 'Would create' : 'Created'} ${created.length} account(s) and ` +
    `${DRY_RUN ? 'would file' : 'filed'} ${refiled.length} existing one(s).`,
  );
  if (!DRY_RUN && created.length > 0) {
    console.log('New accounts get their first reading from tonight\'s cron (/api/cron/growth-tracking).');
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
