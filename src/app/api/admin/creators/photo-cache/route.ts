/**
 * POST /api/admin/creators/photo-cache — normalise existing creator avatars.
 *
 * Brings photos uploaded before the current policy in line with it. Three things
 * are wrong with them, and this fixes all of them in one pass:
 *
 * 1. **Format.** They are whatever was uploaded — a multi-hundred-KB JPEG or PNG
 *    at full camera resolution, to be drawn in a 20px circle. Re-encoded to a
 *    256px WebP, typically a 50–200× reduction.
 * 2. **Cache header.** They were written with no `cacheControl`, so Firebase
 *    serves them `private, max-age=0` and the browser re-fetches every avatar on
 *    every page load.
 * 3. **No inline thumbnail.** `photoThumb` did not exist when they were written,
 *    so every avatar still costs a request to Firebase Storage. Derived from the
 *    256px object and written onto the creator doc.
 *
 * Converting changes the stored path (`avatar.jpg` → `avatar.webp`) and mints a
 * new download token, so `photoURL` is rewritten in Firestore and the old object
 * is deleted. An avatar already in the right format is repaired **in place** —
 * `setMetadata` for the header and a thumbnail derived from the existing object
 * — which leaves the bytes, the token and the URL alone.
 *
 * **Run once.** Idempotent and safe to re-run; there is nothing to do the second
 * time. Deliberately not wired to a button — this is maintenance, and the
 * endpoint should be deleted once the fleet is converted.
 *
 * ```
 * curl -X POST https://<host>/api/admin/creators/photo-cache \
 *   -H "Authorization: Bearer <admin id token>"
 * ```
 *
 * `?dryRun=true` reports what it would do without writing anything.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  CREATOR_PHOTO_CACHE_CONTROL,
  CREATOR_PHOTO_CONTENT_TYPE,
  creatorPhotoPath,
  encodeCreatorThumb,
  storeCreatorPhoto,
} from '@/lib/services/creatorPhotoService';
import type { DecodedIdToken } from 'firebase-admin/auth';

interface Outcome {
  creator: string;
  action: 'converted' | 'repaired' | 'skipped' | 'failed';
  detail?: string;
  beforeBytes?: number;
  afterBytes?: number;
}

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    // Admin claim: this rewrites objects across a Storage prefix and mutates
    // `photoURL` on every creator.
    if (token.admin !== true) {
      return NextResponse.json({ error: 'This action requires an administrator account.' }, { status: 403 });
    }

    const dryRun = new URL(request.url).searchParams.get('dryRun') === 'true';
    const snap = await adminDb.collection('creators').select('photoStoragePath', 'stageName', 'photoThumb').get();
    const bucket = adminStorage.bucket();

    // Sequential, not `Promise.all`: each conversion decodes a full-resolution
    // image, and doing eight at once on a serverless instance is how you meet
    // the memory ceiling. There are single-digit creators; this takes seconds.
    const outcomes: Outcome[] = [];

    for (const doc of snap.docs) {
      const name = (doc.data()?.stageName as string | undefined) ?? doc.id;
      const path = doc.data()?.photoStoragePath as string | undefined;
      const hasThumb = typeof doc.data()?.photoThumb === 'string';

      if (!path) {
        outcomes.push({ creator: name, action: 'skipped', detail: 'no photo' });
        continue;
      }

      try {
        const file = bucket.file(path);
        const [exists] = await file.exists();
        if (!exists) {
          outcomes.push({ creator: name, action: 'skipped', detail: 'file missing from storage' });
          continue;
        }

        const [metadata] = await file.getMetadata();
        const beforeBytes = Number(metadata.size ?? 0);
        const isWebp = metadata.contentType === CREATOR_PHOTO_CONTENT_TYPE && path === creatorPhotoPath(doc.id);
        const headerOk = metadata.cacheControl === CREATOR_PHOTO_CACHE_CONTROL;

        if (isWebp && headerOk && hasThumb) {
          outcomes.push({ creator: name, action: 'skipped', detail: 'already normalised', beforeBytes });
          continue;
        }

        if (isWebp) {
          // Right format, but missing the header and/or the thumbnail. Both are
          // repairable without touching the bytes or the download token, so the
          // stored `photoURL` stays valid and no cache is invalidated.
          const repairs: string[] = [];

          if (!headerOk) {
            if (!dryRun) await file.setMetadata({ cacheControl: CREATOR_PHOTO_CACHE_CONTROL });
            repairs.push('cache header');
          }

          if (!hasThumb) {
            if (!dryRun) {
              // Derived from the stored 256px object, not the original upload —
              // the original may be long gone, and re-cropping it could pick a
              // different `position: 'attention'` window than the full image.
              const [stored] = await file.download();
              const photoThumb = await encodeCreatorThumb(stored);
              await adminDb.collection('creators').doc(doc.id).update({
                photoThumb,
                updatedAt: FieldValue.serverTimestamp(),
              });
            }
            repairs.push('thumbnail');
          }

          outcomes.push({
            creator: name,
            action: 'repaired',
            detail: repairs.join(' + '),
            beforeBytes,
            afterBytes: beforeBytes,
          });
          continue;
        }

        if (dryRun) {
          outcomes.push({ creator: name, action: 'converted', detail: `${metadata.contentType} → webp`, beforeBytes });
          continue;
        }

        const [original] = await file.download();
        const stored = await storeCreatorPhoto(doc.id, original, token.uid, path);

        await adminDb.collection('creators').doc(doc.id).update({
          photoURL: stored.photoURL,
          photoStoragePath: stored.photoStoragePath,
          photoThumb: stored.photoThumb,
          updatedAt: FieldValue.serverTimestamp(),
        });

        outcomes.push({
          creator: name,
          action: 'converted',
          detail: `${metadata.contentType} → webp`,
          beforeBytes,
          afterBytes: stored.bytes,
        });
      } catch (err) {
        outcomes.push({
          creator: name,
          action: 'failed',
          detail: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const saved = outcomes.reduce(
      (sum, o) => sum + (o.action === 'converted' ? (o.beforeBytes ?? 0) - (o.afterBytes ?? 0) : 0),
      0,
    );
    const count = (action: Outcome['action']) => outcomes.filter(o => o.action === action).length;

    return NextResponse.json({
      dryRun,
      outcomes,
      summary:
        `${count('converted')} converted, ${count('repaired')} repaired, ` +
        `${count('skipped')} skipped, ${count('failed')} failed` +
        (saved > 0 ? ` · ${(saved / 1024).toFixed(0)}KB saved` : ''),
    });
  } catch (err) {
    return handleApiError(err, 'admin/creators/photo-cache POST');
  }
});
