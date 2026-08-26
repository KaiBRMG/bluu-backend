#!/usr/bin/env node
/**
 * One-off cleanup for pages retired from src/lib/definitions.ts (2026-08-26).
 *
 *   admin-resource-management  — merged into the Resources page
 *   apps-resources             — moved out of the Apps teamspace into
 *                                UNIVERSAL_PAGES; org-wide, so it now has no
 *                                page permission at all
 *
 * Removing a page from `PAGES` leaves two orphans in Firestore:
 *   1. page-permissions/{pageId}
 *   2. the pageId still sitting in users/{uid}.permittedPageIds
 *
 * Orphan 1 matters beyond tidiness: repair-permissions.js **hard-aborts** on a
 * page-permissions doc whose pageId it cannot find in definitions.ts, so until
 * this runs, that script refuses to work at all.
 *
 * Usage (run from src/):
 *   node scripts/remove-retired-pages.js          # dry run
 *   node scripts/remove-retired-pages.js --fix    # write changes
 *
 * Delete this script once it has been run against production.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PAGE_IDS = ['admin-resource-management', 'apps-resources'];

// ─── Load env ──────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT is not set and could not be read from .env.local');
  process.exit(1);
}

// ─── Safety guard ──────────────────────────────────────────────────────────
//
// Refuse to strip a pageId that definitions.ts still declares. Without this,
// a later run (or a copy-paste of this script) could revoke a live page from
// the whole fleet — the same failure mode that made repair-permissions.js
// dangerous when it carried a hardcoded page list.

function assertRetired(pageIds) {
  const defPath = path.resolve(__dirname, '..', 'lib', 'definitions.ts');
  if (!fs.existsSync(defPath)) {
    console.error(`ERROR: cannot find ${defPath} — refusing to run without it.`);
    process.exit(1);
  }
  const source = fs.readFileSync(defPath, 'utf8');
  // Only `pageId: 'x'` declarations count — a mention in a comment does not.
  const declared = new Set(
    Array.from(source.matchAll(/pageId:\s*['"]([^'"]+)['"]/g), m => m[1])
  );
  if (declared.size === 0) {
    console.error('ERROR: parsed 0 pages out of definitions.ts — refusing to run.');
    process.exit(1);
  }
  const live = pageIds.filter(id => declared.has(id));
  if (live.length > 0) {
    console.error(`ERROR: still declared in definitions.ts: ${live.join(', ')}`);
    console.error('This script only removes RETIRED pages. Refusing to run.');
    process.exit(1);
  }
}

assertRetired(PAGE_IDS);

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const FIX = process.argv.includes('--fix');

async function main() {
  console.log(FIX ? 'MODE: --fix (writing)' : 'MODE: dry run (no writes)');
  console.log(`Target pageIds: ${PAGE_IDS.join(', ')}\n`);

  // ─── 1. The page-permissions docs ────────────────────────────────────────
  for (const pageId of PAGE_IDS) {
    const ref = db.collection('page-permissions').doc(pageId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`page-permissions/${pageId}: already absent`);
      continue;
    }
    const data = snap.data() ?? {};
    console.log(`page-permissions/${pageId}:`);
    console.log(`  groups: ${JSON.stringify(data.groups ?? {})}`);
    console.log(`  users:  ${JSON.stringify(data.users ?? {})}`);
    if (FIX) {
      await ref.delete();
      console.log('  → deleted');
    } else {
      console.log('  → would delete');
    }
  }

  // ─── 2. permittedPageIds on every user ───────────────────────────────────
  const usersSnap = await db.collection('users').get();
  const affected = usersSnap.docs.filter(d => {
    const ids = d.data().permittedPageIds;
    return Array.isArray(ids) && PAGE_IDS.some(p => ids.includes(p));
  });

  console.log(`\nusers carrying a retired pageId: ${affected.length} of ${usersSnap.size}`);
  for (const d of affected) {
    const ids = d.data().permittedPageIds;
    const hit = PAGE_IDS.filter(p => ids.includes(p));
    console.log(`  ${d.data().workEmail || d.id} — ${hit.join(', ')}`);
  }

  if (affected.length > 0 && FIX) {
    // arrayRemove touches only these entries — unlike repair-permissions.js,
    // which overwrites the whole array.
    const writer = db.bulkWriter();
    for (const d of affected) {
      writer.update(d.ref, {
        permittedPageIds: admin.firestore.FieldValue.arrayRemove(...PAGE_IDS),
        // Bumped so open clients pick the change up from their users/{uid}
        // snapshot instead of waiting for a reload.
        permissionsVersion: admin.firestore.FieldValue.increment(1),
      });
    }
    await writer.close();
    console.log(`  → cleaned ${affected.length} user(s)`);
  } else if (affected.length > 0) {
    console.log(`  → would clean ${affected.length} user(s)`);
  }

  console.log(FIX ? '\nDone.' : '\nDry run complete. Re-run with --fix to apply.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
