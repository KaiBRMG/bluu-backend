#!/usr/bin/env node
/**
 * Audits every user's permittedPageIds against what the page-permissions
 * collection says they should have, based on their groups membership.
 *
 * Usage (run from src/):
 *   node scripts/repair-permissions.js          # dry run — audit only
 *   node scripts/repair-permissions.js --fix    # write corrections to Firestore
 *
 * Reads FIREBASE_SERVICE_ACCOUNT from the environment or from src/.env.local.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// ─── Load env ──────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
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

// ─── Firebase init ─────────────────────────────────────────────────────────

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ─── Page definitions (mirrors src/lib/definitions.ts) ────────────────────

const PAGES = [
  { pageId: 'ca-admin',                 teamspaceId: 'ca-portal' },
  { pageId: 'ca-dashboard',             teamspaceId: 'ca-portal' },
  { pageId: 'ca-shifts',                teamspaceId: 'ca-portal' },
  { pageId: 'ca-disputes',              teamspaceId: 'ca-portal' },
  { pageId: 'ca-custom-requests',       teamspaceId: 'ca-portal' },
  { pageId: 'ca-campaigns',             teamspaceId: 'ca-portal' },
  { pageId: 'user-management',          teamspaceId: 'admin'     },
  { pageId: 'sharing',                  teamspaceId: 'admin'     },
  { pageId: 'shift-management',         teamspaceId: 'admin'     },
  { pageId: 'admin-notifications',      teamspaceId: 'admin'     },
  { pageId: 'admin-creator-management', teamspaceId: 'admin'     },
  { pageId: 'creators-custom-requests', teamspaceId: 'creators'  },
  { pageId: 'creators-content-planning',teamspaceId: 'creators'  },
  { pageId: 'time-tracking',            teamspaceId: 'apps'      },
  { pageId: 'apps-password-manager',    teamspaceId: 'apps'      },
];
const ALL_PAGE_IDS = new Set(PAGES.map(p => p.pageId));

// ─── Permission resolver (mirrors src/lib/services/permissionResolver.ts) ──

function resolveAccessiblePageIds(permDocs, uid, userGroups) {
  const permMap = new Map();
  for (const doc of permDocs) permMap.set(doc.pageId, doc);

  const accessible = [];
  for (const page of PAGES) {
    const perm = permMap.get(page.pageId);
    if (!perm) continue;
    if (perm.users?.[uid]) { accessible.push(page.pageId); continue; }
    for (const g of userGroups) {
      if (perm.groups?.[g]) { accessible.push(page.pageId); break; }
    }
  }
  return accessible;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const fix = process.argv.includes('--fix');
  console.log(`\n=== Permission Audit${fix ? ' (FIX mode)' : ' (dry run)'} ===\n`);

  // Fetch all data in parallel
  const [usersSnap, permSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('page-permissions').get(),
  ]);

  const permDocs = permSnap.docs.map(d => d.data());

  // Validate page-permissions collection coverage
  const permPageIds = new Set(permDocs.map(d => d.pageId));
  const missingPermDocs = [...ALL_PAGE_IDS].filter(id => !permPageIds.has(id));
  if (missingPermDocs.length > 0) {
    console.warn('WARNING: The following pages have no page-permissions document:');
    missingPermDocs.forEach(id => console.warn(`  - ${id}`));
    console.warn('');
  }

  let totalUsers = 0;
  let usersWithDrift = 0;
  let usersFixed = 0;
  const batch = db.batch();
  let batchSize = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    const groups = data.groups ?? [];
    const actual = data.permittedPageIds ?? null;

    const expected = resolveAccessiblePageIds(permDocs, uid, groups);

    const actualSet = new Set(actual ?? []);
    const expectedSet = new Set(expected);

    const missing = expected.filter(id => !actualSet.has(id));   // should have but doesn't
    const extra   = (actual ?? []).filter(id => !expectedSet.has(id)); // has but shouldn't

    totalUsers++;

    if (missing.length === 0 && extra.length === 0) continue;

    usersWithDrift++;
    console.log(`User: ${data.displayName ?? uid} (${uid})`);
    console.log(`  Groups: [${groups.join(', ')}]`);
    if (missing.length > 0) console.log(`  MISSING: ${missing.join(', ')}`);
    if (extra.length > 0)   console.log(`  EXTRA:   ${extra.join(', ')}`);

    if (fix) {
      batch.update(db.collection('users').doc(uid), {
        permittedPageIds: expected,
        permissionsVersion: admin.firestore.FieldValue.increment(1),
      });
      batchSize++;
      usersFixed++;
    }
    console.log('');
  }

  console.log(`─── Summary ───────────────────────────────────────────`);
  console.log(`Total users checked : ${totalUsers}`);
  console.log(`Users with drift    : ${usersWithDrift}`);

  if (fix && batchSize > 0) {
    await batch.commit();
    console.log(`Users corrected     : ${usersFixed}`);
  } else if (!fix && usersWithDrift > 0) {
    console.log(`\nRe-run with --fix to apply corrections.`);
  } else {
    console.log(`All users are in sync. No corrections needed.`);
  }

  await admin.app().delete();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
