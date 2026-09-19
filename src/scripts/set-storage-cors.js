#!/usr/bin/env node
/**
 * Apply (or inspect) the Cloud Storage bucket's CORS policy.
 *
 *   cd src && node scripts/set-storage-cors.js --info    # show current policy
 *   cd src && node scripts/set-storage-cors.js           # apply storage-cors.json
 *
 * **Why this exists instead of the documented `gcloud` command.** Nothing in
 * this team's toolchain installs the Cloud SDK — `gcloud` and `gsutil` are both
 * absent — so a runbook that says "run gcloud" is a runbook nobody can follow.
 * `setCorsConfiguration` is the same API call the CLI makes, and the Admin SDK
 * service account this repo already uses is credential enough for it.
 *
 * **Why the policy matters at all.** Both signed-URL upload paths (Snipping Tool
 * captures and OnlyFans media) have the renderer `PUT` bytes straight to
 * `storage.googleapis.com`, so the megabytes never cross Vercel (rule 9i). A
 * `PUT` is never a "simple" CORS request, so the browser sends a preflight
 * `OPTIONS` first — every time, regardless of headers. A bucket with no CORS
 * policy has nothing to answer that preflight with, and the renderer sees a bare
 * `TypeError: Failed to fetch`: no status, no body, nothing to diagnose from.
 *
 * The policy itself lives in `storage-cors.json` at the REPO root (not in
 * `src/`), because it is infrastructure rather than application code and it is
 * also what the `gcloud` invocation in the docs takes. **Adding a domain to the
 * app means adding it there too**, or uploads work everywhere except the new
 * one. See documentation/snipping-tool.md.
 *
 * Idempotent: applying the same policy twice is a no-op, and `--info` never
 * writes.
 */

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  loadEnvLocal();

  const infoOnly = process.argv.includes('--info');

  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) fail('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set in src/.env.local');

  const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawCredentials) fail('FIREBASE_SERVICE_ACCOUNT is not set in src/.env.local');

  let credentials;
  try {
    credentials = JSON.parse(rawCredentials);
  } catch {
    fail('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }

  const { Storage } = require('@google-cloud/storage');
  const bucket = new Storage({
    projectId: credentials.project_id,
    credentials,
  }).bucket(bucketName);

  console.log(`\n  Bucket:  gs://${bucketName}`);
  console.log(`  Actor:   ${credentials.client_email}\n`);

  const [before] = await bucket.getMetadata();
  console.log('  Current CORS policy:');
  console.log(
    before.cors ? indent(JSON.stringify(before.cors, null, 2)) : '    (none — every signed PUT from a browser fails)',
  );

  if (infoOnly) {
    console.log('');
    return;
  }

  const policyFile = path.join(__dirname, '..', '..', 'storage-cors.json');
  if (!fs.existsSync(policyFile)) fail(`Policy file not found: ${policyFile}`);

  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  } catch (err) {
    fail(`storage-cors.json is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(policy) || policy.length === 0) {
    fail('storage-cors.json must be a non-empty array of CORS entries');
  }

  console.log('\n  Applying storage-cors.json:');
  console.log(indent(JSON.stringify(policy, null, 2)));

  try {
    await bucket.setCorsConfiguration(policy);
  } catch (err) {
    // The overwhelmingly likely failure is IAM, and the message Google returns
    // for it does not name the permission — so say which one it is rather than
    // leaving someone to guess at roles.
    if (err.code === 403) {
      fail(
        `Permission denied. ${credentials.client_email} needs storage.buckets.update ` +
          '— grant it "Storage Admin" (roles/storage.admin) on the bucket, then re-run.',
      );
    }
    fail(`setCorsConfiguration failed: ${err.message}`);
  }

  // Read back rather than trusting the write. This is the whole point of the
  // script: a policy that did not land looks identical to one that did.
  const [after] = await bucket.getMetadata();
  console.log('\n  ✓ Applied. Bucket now reports:');
  console.log(indent(JSON.stringify(after.cors, null, 2)));
  console.log('\n  Restart the desktop app before retrying an upload — a failed');
  console.log('  preflight can sit in the renderer\'s cache for a few minutes.\n');
}

function indent(text) {
  return text
    .split('\n')
    .map(line => `    ${line}`)
    .join('\n');
}

main().catch(err => {
  console.error('\n  ✗ Unexpected failure:', err);
  process.exit(1);
});
