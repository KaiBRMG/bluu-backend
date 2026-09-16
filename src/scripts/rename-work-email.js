'use strict';
// Run from the Next.js project root: cd src && node scripts/rename-work-email.js \
//   --uid YGi56AeMvrVDoNtSyDQgoUvRcOr1 --from julie@bluurock.com --to jorge@bluurock.com
//
// Dry-run by default. Add --commit to actually write.
//
// ─── WHY THIS EXISTS (and why the migration subsystem cannot do it) ──────────
// `src/lib/emailMigrationConfig.ts` gates three directions, and every one of
// them crosses the company-domain boundary:
//   • EMAIL_MIGRATION            @bluurock.com → personal
//   • EMAIL_MIGRATION_REVERSAL   personal      → @bluurock.com
//   • EMAIL_MIGRATION_CORRECTION personal      → a different personal
// A Workspace-console rename (julie@ → jorge@, same mailbox, old address kept
// as an alias) is company → company. Arming any cohort for it produces either
// no card at all or a 409 from POST /api/auth/migrate-email.
//
// It is also unreachable in principle, not just in configuration: every card in
// that subsystem renders inside the authenticated app shell, and after a
// Workspace rename Google's userinfo returns the NEW primary address while
// `auth-emails` still holds the old one — so `findUserUidByEmail` misses and
// exchange-code refuses the login with the generic ACCESS_DENIED. The user
// cannot sign in to be prompted. Hence a server-side repair.
//
// ─── WRITE ORDER IS NOT INTERCHANGEABLE ─────────────────────────────────────
// Same rule as the header of src/app/api/auth/migrate-email/route.ts: the
// Firestore doc + `auth-emails` index commit FIRST, in one transaction; the
// Firebase Auth account is updated after, and a failure there is logged, not
// fatal.
//   • doc committed, Auth failed → login by the NEW address already works
//     (exchange-code keys off the doc and reconciles Auth on next login).
//   • Auth committed, doc failed → the old address is gone from Auth and the
//     new one was never registered: the user can log in with NEITHER. A hard
//     lockout from a transient blip.
//
// The uid never changes, so shifts, time ledger, permissions, group membership
// and any live session all survive untouched.
//
// Re-running after a successful run is a no-op (it exits on "already on that
// address"). Idempotent and safe.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

// ─── Args ────────────────────────────────────────────────────────────────────
const COMMIT = process.argv.includes('--commit');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UID = arg('uid');
const FROM = arg('from');
const TO = arg('to');

if (!UID || !FROM || !TO) {
  console.error('Usage: node scripts/rename-work-email.js --uid <uid> --from <old@> --to <new@> [--commit]');
  process.exit(1);
}

// ─── .env.local ──────────────────────────────────────────────────────────────
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
const auth = admin.auth();

const AUTH_EMAIL_COLLECTION = 'auth-emails';

// Mirror of normalizeEmail() in src/lib/authEmail.ts. Kept in sync by hand
// because this script is plain CJS and cannot import the TS module.
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
function normalizeEmail(email) {
  if (!email) return '';
  const trimmed = String(email).trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return '';
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    const plus = local.indexOf('+');
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replace(/\./g, '');
    if (local === '') return '';
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

async function main() {
  const fromKey = normalizeEmail(FROM);
  const toKey = normalizeEmail(TO);
  if (!fromKey || !toKey) throw new Error('Unusable --from or --to address.');
  if (fromKey === toKey) throw new Error('--from and --to are the same address.');

  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${UID}: ${FROM} → ${TO}\n`);

  // ─── Preflight ─────────────────────────────────────────────────────────────
  const userRef = db.collection('users').doc(UID);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new Error(`No users doc for uid ${UID}.`);

  const data = userSnap.data();
  const currentKey = normalizeEmail(data.workEmail);

  if (currentKey === toKey) {
    console.log('  Already on the target address — nothing to do.');
    return;
  }
  // Guards against a mistyped uid silently re-pointing somebody else's login.
  if (currentKey !== fromKey) {
    throw new Error(
      `Refusing: uid ${UID} holds "${data.workEmail}", not "${FROM}". ` +
      'Check the uid and the --from address.',
    );
  }

  console.log(`  users/${UID}`);
  console.log(`    displayName:  ${data.displayName ?? '(none)'}`);
  console.log(`    workEmail:    ${data.workEmail}`);
  console.log(`    groups:       ${(data.groups ?? []).join(', ') || '(none)'}`);
  console.log(`    isActive:     ${data.isActive}  isArchived: ${data.isArchived}`);

  // Is the destination free? Covers another employee, a creator (same Auth
  // project), and leftover test accounts — anything resolving to a different
  // uid is a hard no. Mirrors the collision checks in migrate-email.
  const targetIndex = await db.collection(AUTH_EMAIL_COLLECTION).doc(toKey).get();
  if (targetIndex.exists && targetIndex.data()?.uid !== UID) {
    throw new Error(`auth-emails/${toKey} is already claimed by uid ${targetIndex.data().uid}.`);
  }
  const clash = await db.collection('users').where('workEmail', '==', TO).limit(1).get();
  if (!clash.empty && clash.docs[0].id !== UID) {
    throw new Error(`users/${clash.docs[0].id} already holds workEmail "${TO}".`);
  }
  try {
    const existingAuth = await auth.getUserByEmail(TO);
    if (existingAuth.uid !== UID) {
      throw new Error(`Firebase Auth user ${existingAuth.uid} already holds "${TO}".`);
    }
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }
  console.log(`\n  "${TO}" is free.`);

  if (!COMMIT) {
    console.log('\n  Would write:');
    console.log(`    users/${UID}         workEmail = "${TO}", previousWorkEmail = "${data.workEmail}"`);
    console.log(`    auth-emails/${toKey}   set   { uid: ${UID} }`);
    console.log(`    auth-emails/${fromKey}  delete`);
    console.log(`    Auth ${UID}            email = "${TO}"  (after the transaction)`);
    console.log('\n  Re-run with --commit to apply.');
    return;
  }

  // ─── 1. Firestore first (doc + index in one transaction) ──────────────────
  await db.runTransaction(async (tx) => {
    const ref = db.collection(AUTH_EMAIL_COLLECTION).doc(toKey);
    const existing = await tx.get(ref);
    if (existing.exists && existing.data()?.uid !== UID) {
      throw new Error('EMAIL_TAKEN');
    }

    tx.set(ref, { uid: UID, email: TO, updatedAt: FieldValue.serverTimestamp() });
    tx.delete(db.collection(AUTH_EMAIL_COLLECTION).doc(fromKey));

    tx.update(userRef, {
      workEmail: TO,
      // The only surviving record of the old address once the index entry goes.
      // Deliberately NOT writing emailMigratedAt/emailCorrectedAt: this is not
      // the personal-email migration and must not report as one.
      previousWorkEmail: data.workEmail ?? null,
    });
  });
  console.log('  ✓ Firestore committed (users doc + auth-emails index).');

  // ─── 2. Auth after — non-fatal by design (see header) ─────────────────────
  try {
    await auth.updateUser(UID, { email: TO });
    console.log('  ✓ Firebase Auth updated.');
  } catch (err) {
    console.error(
      '  ! Auth update failed — NOT fatal. Login already works off the users doc, ' +
      'and exchange-code reconciles Auth on the next sign-in.',
      err,
    );
  }

  console.log(
    '\n  Done. getUserById has a 60s cache per serverless instance, so the new ' +
    'address may take up to a minute to appear on admin surfaces.',
  );
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(`\n  FAILED: ${err.message || err}`);
  process.exit(1);
});
