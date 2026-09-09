'use strict';
// Run from the app root: cd src && node scripts/recategorise-facebook.js --dry-run
// Drop --dry-run to write. ALWAYS dry-run first — it prints the full before/after.
//
// ── What this is ────────────────────────────────────────────────────────────
// A ONE-OFF migration, run once on 2026-09-09 when the category vocabulary was
// split by platform. Before it, every Facebook page sat in a single `FACEBOOK`
// category — a "category" that only restated the platform mark already on the
// row and told you nothing about the page. Facebook pages are now GENERAL or
// CREATOR, matching src/lib/growth/category.ts.
//
// Delete this file once it has run everywhere it needs to. It is not a
// maintenance tool: re-filing one account is a picker in Manage accounts, and
// re-filing the roster in bulk is import-growth-accounts.js.
//
// ── What it touches ─────────────────────────────────────────────────────────
// EXACTLY ONE FIELD, `category`, on documents whose `platform` is `facebook`.
// Not `latest`, not `previous`, not `isActive`, not a scrape stamp, and nothing
// in the `series` subtree — those hold two months of hand-typed history that
// cannot be re-collected, because the scrapers only ever return TODAY's number.
// X accounts are not read and not written.
//
// It is idempotent: a second run finds every page already correct and writes
// nothing. That is also what makes it safe to re-run after adding a handle to
// CREATOR_HANDLES below.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const DRY_RUN = process.argv.includes('--dry-run');

const GROWTH_ACCOUNTS = 'growth-accounts';

/**
 * The Facebook pages belonging to a creator. Everything else on Facebook is
 * GENERAL.
 *
 * Matched on the **normalised** (lower-cased) handle, which is what the document
 * id is built from, so the casing typed here does not matter. A handle listed
 * here that is not on the roster is reported rather than ignored — it means a
 * page was renamed, or the list has a typo, and silently filing one fewer
 * account as CREATOR is exactly the failure nobody would notice.
 */
const CREATOR_HANDLES = [
  'adamtwinkx',
  'xColeBentley',
  'connorsfacebook',
  'LeoTwxnk',
  'NoahRyderXX',
].map((h) => h.trim().replace(/^@/, '').toLowerCase());

/** Mirror of CATEGORIES_BY_PLATFORM.facebook in src/lib/growth/category.ts. */
const CREATOR = 'CREATOR';
const GENERAL = 'GENERAL';

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
  console.log(DRY_RUN ? 'DRY RUN — nothing will be written\n' : 'Writing…\n');

  initFirebase();

  // One query, filtered server-side. `platform` is an indexed field on this
  // collection (it is `category` and the denormalised readings that are
  // index-exempt), so this reads only the Facebook documents rather than the
  // whole roster.
  const snap = await db.collection(GROWTH_ACCOUNTS).where('platform', '==', 'facebook').get();

  if (snap.empty) {
    console.log('No Facebook accounts on the roster — nothing to do.');
    return;
  }

  const planned = snap.docs.map((doc) => {
    const data = doc.data();
    const handleNormalized = String(data.handleNormalized || data.handle || '').toLowerCase();
    const target = CREATOR_HANDLES.includes(handleNormalized) ? CREATOR : GENERAL;
    return {
      id: doc.id,
      handle: data.handle || handleNormalized,
      handleNormalized,
      before: data.category ?? null,
      after: target,
      changed: (data.category ?? null) !== target,
    };
  });

  const matched = new Set(planned.map((p) => p.handleNormalized));
  const missing = CREATOR_HANDLES.filter((h) => !matched.has(h));

  const creators = planned.filter((p) => p.after === CREATOR);
  const general = planned.filter((p) => p.after === GENERAL);
  const changing = planned.filter((p) => p.changed);

  console.log(`${planned.length} Facebook account(s) on the roster\n`);

  const width = Math.max(...planned.map((p) => p.handle.length), 8);
  for (const p of planned.sort((a, b) => a.after.localeCompare(b.after) || a.handle.localeCompare(b.handle))) {
    console.log(
      `  ${p.changed ? '~' : '·'} ${p.handle.padEnd(width)}  ${String(p.before ?? '(none)').padEnd(10)} -> ${p.after}` +
      (p.changed ? '' : '  (already correct)'),
    );
  }

  console.log(
    `\n${creators.length} -> ${CREATOR} · ${general.length} -> ${GENERAL}` +
    `\n${changing.length} document(s) to write, ${planned.length - changing.length} already correct.`,
  );

  if (missing.length > 0) {
    // Loud, and it does not stop the run: the pages that DO match are still
    // correct to file. But a handle in the list with no page behind it means one
    // creator's page is about to be filed as GENERAL, which is the one outcome
    // this script exists to prevent.
    console.warn(
      `\n! ${missing.length} handle(s) in CREATOR_HANDLES matched no Facebook account: ` +
      `${missing.join(', ')}` +
      `\n  Check the spelling against Manage accounts — a renamed page keeps its ` +
      `numeric id and loses its handle. Anything not matched here stays GENERAL.`,
    );
  }

  if (DRY_RUN) {
    console.log('\nDry run — nothing written. Re-run without --dry-run to apply.');
    return;
  }

  if (changing.length === 0) {
    console.log('\nNothing to write.');
    return;
  }

  // A few dozen single-field merges: one batch, one round trip. `set` with
  // `merge` rather than `update` so a document missing the field is fine, and
  // THE ONE FIELD — anything else here would overwrite readings that cannot be
  // collected again.
  const batch = db.batch();
  for (const p of changing) {
    batch.set(db.collection(GROWTH_ACCOUNTS).doc(p.id), { category: p.after }, { merge: true });
  }
  await batch.commit();

  console.log(`\nWrote ${changing.length} document(s). Nothing else was touched.`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
