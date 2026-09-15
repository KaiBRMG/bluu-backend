'use strict';
// Run from the repo root:  cd src && node scripts/normalize-creator-photos.js
//   --dry-run   report what would change, write nothing
//
// Normalises every existing creator avatar to the current policy. This is the
// same work as `POST /api/admin/creators/photo-cache`, done against the Admin
// SDK directly so it needs a service account rather than an admin ID token.
//
// WHY THIS EXISTS
// Creator avatars were slow to appear and sometimes never appeared at all. The
// bytes were never the problem: thirty avatars on a shift calendar were thirty
// separate cross-origin requests to firebasestorage.googleapis.com — a host
// that is not a CDN and validates the ?token= on every request — so the cost
// was thirty round trips of latency and thirty independent chances to fail.
//
// Three things are wrong with photos written before the current policy, and
// this fixes all of them in one pass:
//
//   1. FORMAT       Whatever was uploaded, at full camera resolution, to be
//                   drawn in a 20px circle. Re-encoded to a 256px WebP —
//                   typically a 50-200x reduction.
//   2. CACHE HEADER Written with no cacheControl, so Firebase serves them
//                   `private, max-age=0` and the browser re-fetches every
//                   avatar on every page load.
//   3. NO THUMBNAIL `photoThumb` did not exist when they were written. It is a
//                   64px WebP data: URI on the creator doc, delivered inline
//                   with the roster, and it is what removes the request class
//                   entirely — the face now arrives in the same payload as the
//                   name.
//
// Converting a non-WebP photo changes its stored path (avatar.jpg ->
// avatar.webp) and mints a new download token, so `photoURL` is rewritten and
// the old object deleted. A photo already in the right format is repaired IN
// PLACE — setMetadata for the header, a thumbnail derived from the existing
// object — which leaves the bytes, the token and the URL alone, so no browser
// cache is invalidated needlessly.
//
// Idempotent and safe to re-run; there is nothing to do the second time.
// Sequential on purpose: decoding eight full-resolution images at once is how
// you meet a memory ceiling.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const sharp = require('sharp');
const { randomUUID } = require('node:crypto');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── .env.local ───────────────────────────────────────────────────────────────
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
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

// ─── Policy ───────────────────────────────────────────────────────────────────
// Mirrors src/lib/services/creatorPhotoService.ts. Kept in sync by hand — this
// script is plain CJS and cannot import the TS module. If you change a value
// there, change it here; the service is the source of truth.

const CACHE_CONTROL = 'private, max-age=604800, immutable';
const CONTENT_TYPE = 'image/webp';
const EXTENSION = 'webp';
const MAX_EDGE = 256;
const WEBP_QUALITY = 88;
const THUMB_EDGE = 64;
const THUMB_QUALITY = 68;
const MAX_THUMB_BYTES = 6 * 1024;
const LIMIT_INPUT_PIXELS = 80_000_000;
const ALLOWED_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'heif', 'avif'];

const photoPath = creatorId => `creator-photos/${creatorId}/avatar.${EXTENSION}`;

const photoUrl = (filePath, downloadToken) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    filePath,
  )}?alt=media&token=${downloadToken}`;

/** Decode, validate, square-crop and re-encode to a 256px WebP. */
async function encodePhoto(buffer) {
  const metadata = await sharp(buffer, { limitInputPixels: LIMIT_INPUT_PIXELS, animated: false }).metadata();
  if (!ALLOWED_FORMATS.includes(metadata.format || '')) {
    throw new Error(`unsupported format: ${metadata.format || 'unknown'}`);
  }
  return sharp(buffer, { limitInputPixels: LIMIT_INPUT_PIXELS, animated: false })
    // Honours EXIF orientation before the crop, and drops the EXIF block with
    // it — including any GPS coordinates that came off a phone.
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'cover', position: 'attention', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

/**
 * The inline thumbnail, derived from the STORED 256px object rather than the
 * original upload. That object has already been EXIF-rotated and
 * attention-cropped, so re-deriving from it guarantees the same crop as the
 * full image — two independent `position: 'attention'` passes at different
 * resolutions can legitimately pick different windows, which would show as the
 * face jumping when a surface upgrades from thumb to full.
 *
 * Returns null rather than throwing: a creator without a thumbnail renders from
 * `photoURL` as before, so a failure here degrades the optimisation and never
 * the feature.
 */
async function encodeThumb(webp) {
  try {
    const thumb = await sharp(webp, { limitInputPixels: LIMIT_INPUT_PIXELS, animated: false })
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    if (thumb.length > MAX_THUMB_BYTES) return null;
    return `data:${CONTENT_TYPE};base64,${thumb.toString('base64')}`;
  } catch (err) {
    console.error(`    thumb encode failed: ${err.message}`);
    return null;
  }
}

const kb = bytes => `${(bytes / 1024).toFixed(0)}KB`;

async function main() {
  if (!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
    console.error('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set (src/.env.local).');
    process.exit(1);
  }

  console.log(`\nBucket: ${bucket.name}`);
  console.log(DRY_RUN ? 'DRY RUN — nothing will be written.\n' : 'LIVE RUN — writing changes.\n');

  const snap = await db.collection('creators').select('stageName', 'photoStoragePath', 'photoThumb').get();

  const counts = { converted: 0, repaired: 0, skipped: 0, failed: 0 };
  let saved = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const name = data.stageName || doc.id;
    const storagePath = data.photoStoragePath;
    const hasThumb = typeof data.photoThumb === 'string';

    if (!storagePath) {
      counts.skipped += 1;
      console.log(`·  ${name} — skipped (no photo)`);
      continue;
    }

    try {
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) {
        counts.skipped += 1;
        console.log(`·  ${name} — skipped (file missing from storage)`);
        continue;
      }

      const [metadata] = await file.getMetadata();
      const beforeBytes = Number(metadata.size || 0);
      const isWebp = metadata.contentType === CONTENT_TYPE && storagePath === photoPath(doc.id);
      const headerOk = metadata.cacheControl === CACHE_CONTROL;

      if (isWebp && headerOk && hasThumb) {
        counts.skipped += 1;
        console.log(`·  ${name} — skipped (already normalised, ${kb(beforeBytes)})`);
        continue;
      }

      // ── Repair in place: right format, missing header and/or thumbnail ──
      if (isWebp) {
        const repairs = [];

        if (!headerOk) {
          if (!DRY_RUN) await file.setMetadata({ cacheControl: CACHE_CONTROL });
          repairs.push('cache header');
        }

        if (!hasThumb) {
          if (!DRY_RUN) {
            const [stored] = await file.download();
            const photoThumb = await encodeThumb(stored);
            await doc.ref.update({
              photoThumb,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
          repairs.push('thumbnail');
        }

        counts.repaired += 1;
        console.log(`✎  ${name} — repaired (${repairs.join(' + ')})`);
        continue;
      }

      // ── Convert: wrong format or wrong path ──
      if (DRY_RUN) {
        counts.converted += 1;
        console.log(`→  ${name} — would convert (${metadata.contentType} → webp, ${kb(beforeBytes)})`);
        continue;
      }

      const [original] = await file.download();
      const webp = await encodePhoto(original);
      const photoThumb = await encodeThumb(webp);

      const filePath = photoPath(doc.id);
      const downloadToken = randomUUID();

      await bucket.file(filePath).save(webp, {
        metadata: {
          contentType: CONTENT_TYPE,
          cacheControl: CACHE_CONTROL,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            uploadedBy: 'scripts/normalize-creator-photos.js',
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      await doc.ref.update({
        photoURL: photoUrl(filePath, downloadToken),
        photoStoragePath: filePath,
        photoThumb,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Best-effort: an orphaned object costs storage, not correctness, so a
      // failure here must not fail a conversion that has already succeeded.
      if (storagePath !== filePath) {
        await bucket
          .file(storagePath)
          .delete()
          .catch(() => null);
      }

      counts.converted += 1;
      saved += beforeBytes - webp.length;
      console.log(
        `→  ${name} — converted (${metadata.contentType} → webp, ${kb(beforeBytes)} → ${kb(webp.length)})`,
      );
    } catch (err) {
      counts.failed += 1;
      console.error(`✗  ${name} — FAILED: ${err.message}`);
    }
  }

  console.log(
    `\n${counts.converted} converted, ${counts.repaired} repaired, ` +
      `${counts.skipped} skipped, ${counts.failed} failed` +
      (saved > 0 ? ` · ${kb(saved)} saved` : ''),
  );

  if (DRY_RUN) console.log('\nDry run — nothing was written. Re-run without --dry-run to apply.');

  process.exit(counts.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
