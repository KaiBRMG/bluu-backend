/**
 * Backfill analytics_daily rollups for historical time-tracking data.
 *
 * The rollupDailyAnalytics Cloud Function only ever computes a 3-day rolling
 * window, so every day before the feature shipped has no rollup and the
 * Analytics tab would read as empty. This script fills that history in.
 *
 * It requires the SAME compute module the Cloud Function uses
 * (functions/rollup.js), so backfilled documents are identical to live ones.
 * This is also the migration tool: bump `version` in the rollup schema and
 * re-run over the affected range.
 *
 * Usage (from repo root):
 *   node src/scripts/backfill-analytics-rollups.js --from=2026-01-01 --to=2026-07-14
 *   node src/scripts/backfill-analytics-rollups.js --from=2026-07-01 --to=2026-07-07 --dry-run
 *   node src/scripts/backfill-analytics-rollups.js --from=... --to=... --user=<uid>
 *
 * Flags:
 *   --from=YYYY-MM-DD  (required)  first local date to compute
 *   --to=YYYY-MM-DD    (required)  last local date to compute (inclusive)
 *   --user=<uid>       restrict to one user
 *   --dry-run          compute and report, write nothing
 *   --force            allow ranges longer than 400 days
 *
 * Safe to re-run: writes are full overwrites keyed by {uid}_{date}.
 *
 * Requires FIREBASE_SERVICE_ACCOUNT in environment (or in src/.env.local).
 */

const path = require('path');
const fs = require('fs');

// Load src/.env.local if present
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

// The single source of truth for rollup computation — shared with the CF.
//
// `admin` MUST come from the rollup module, NOT from a local require. This repo
// has two copies of firebase-admin (src/node_modules v13, functions/node_modules
// v12) and a plain `require('firebase-admin')` here resolves to src's. Firestore
// compares Timestamp/FieldValue by instance, so a handle built from src's copy
// rejects every document rollup.js builds with functions' copy:
//   "Detected an object of type Timestamp that doesn't match the expected
//    instance. Please ensure that the Firestore types you are using are from the
//    same NPM package."
const { admin, rollupUserDay, addCalendarDays } = require('../../functions/rollup');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_WITHOUT_FORCE = 400;

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    args[m[1]] = m[2] ?? true;
  }
  return args;
}

function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

async function run() {
  const args = parseArgs();
  const from = args.from;
  const to = args.to;
  const onlyUser = typeof args.user === 'string' ? args.user : null;
  const dryRun = Boolean(args['dry-run']);
  const force = Boolean(args.force);

  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    console.error('Usage: node src/scripts/backfill-analytics-rollups.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--user=<uid>] [--dry-run] [--force]');
    process.exit(1);
  }
  if (dayNumber(from) > dayNumber(to)) {
    console.error(`--from (${from}) must be on or before --to (${to}).`);
    process.exit(1);
  }

  const totalDays = dayNumber(to) - dayNumber(from) + 1;
  if (totalDays > MAX_DAYS_WITHOUT_FORCE && !force) {
    console.error(`Range is ${totalDays} days (> ${MAX_DAYS_WITHOUT_FORCE}). Re-run with --force if that is intended.`);
    process.exit(1);
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('FIREBASE_SERVICE_ACCOUNT env var is required.');
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
  const db = admin.firestore();

  // Resolve the roster. Archived users are INCLUDED: their history is real and
  // the read path filters them out of current-roster views.
  const usersSnap = await db
    .collection('users')
    .where('permittedPageIds', 'array-contains', 'time-tracking')
    .get();

  let users = usersSnap.docs.map(d => ({ uid: d.id, data: d.data() }));
  if (onlyUser) users = users.filter(u => u.uid === onlyUser);

  if (users.length === 0) {
    console.error(onlyUser ? `User ${onlyUser} not found or not time-tracked.` : 'No time-tracking users found.');
    process.exit(1);
  }

  console.log(
    `[backfill] ${dryRun ? 'DRY RUN — ' : ''}${users.length} user(s) × ${totalDays} day(s) ` +
    `(${from} → ${to}) = ${users.length * totalDays} user-day(s)`,
  );

  let written = 0, deleted = 0, skipped = 0, failed = 0, processed = 0;
  const startedAt = Date.now();

  for (const { uid, data } of users) {
    const name = data.displayName || uid;
    let userWritten = 0;

    for (let date = from; dayNumber(date) <= dayNumber(to); date = addCalendarDays(date, 1)) {
      try {
        const result = await rollupUserDay(db, uid, data, date, { dryRun });
        if (result === 'written') { written++; userWritten++; }
        else if (result === 'deleted') deleted++;
        else skipped++;
      } catch (err) {
        failed++;
        console.error(`[backfill] ${uid} ${date} failed:`, err.message);
      }
      processed++;
      if (processed % 250 === 0) {
        const rate = processed / ((Date.now() - startedAt) / 1000);
        console.log(`[backfill]   … ${processed}/${users.length * totalDays} (${rate.toFixed(1)}/s)`);
      }
    }

    if (userWritten > 0) console.log(`[backfill] ${name}: ${userWritten} day(s) with activity`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[backfill] ${dryRun ? 'DRY RUN complete' : 'Complete'} in ${elapsed}s — ` +
    `written=${written} deleted=${deleted} skipped(no activity)=${skipped} failed=${failed}`,
  );
  if (dryRun) console.log('[backfill] No documents were written. Re-run without --dry-run to apply.');
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[backfill] Fatal:', err);
    process.exit(1);
  });
