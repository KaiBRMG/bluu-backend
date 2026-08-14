import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { adminStorage } from '@/lib/firebase-admin';
import { requireOnlyFansAccess } from '@/lib/services/onlyfansService';
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  OF_UPLOAD_PREFIX,
} from '@/lib/onlyfansUpload';
import { OnlyFansApiError, getOnlyFansClient, resolveAccountId } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * How long the provider has to fetch the file. Short on purpose: the link is the
 * only thing standing between a staged upload and anyone who obtains the URL,
 * and the provider fetches it synchronously inside the call below.
 */
const SIGNED_READ_TTL_MS = 10 * 60 * 1000;

/**
 * POST /api/onlyfans/media/upload — hand an uploaded file to the provider.
 *
 * Second half of the upload described in `src/lib/onlyfansUpload.ts`: the
 * browser has already PUT the file to the slot signed by
 * `/api/onlyfans/media/upload-url`, and this turns that object into an
 * `ofapi_media_…` id the composer can attach to a send.
 *
 * Three things are load-bearing here:
 *
 *  - **The path is re-derived, never trusted.** It must sit under this caller's
 *    own `onlyfans-outgoing/{uid}/` folder. Without that check the route would
 *    read (and publish a signed URL for) any object in the bucket.
 *  - **The staged file is deleted once the provider has it.** The provider
 *    fetches synchronously, so by the time the call returns the copy in our
 *    bucket is dead weight — and it is a fan's media sitting in our storage.
 *  - **The returned id is single-use.** The composer holds it across a failed
 *    send and retries against it rather than paying for a second upload; a
 *    successful send consumes it.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const path = typeof body?.path === 'string' ? body.path : '';

  // Anchored to this caller. `..` cannot climb out of a GCS object name, but the
  // prefix test is what stops one operator reading another's staged upload.
  if (!path.startsWith(`${OF_UPLOAD_PREFIX}/${token.uid}/`) || path.includes('..')) {
    return NextResponse.json({ error: 'Unknown upload' }, { status: 400 });
  }

  try {
    const file = adminStorage.bucket().file(path);
    const [metadata] = await file.getMetadata().catch(() => [null]);
    if (!metadata) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    // The signed PUT pinned the content type, but the size was only ever a
    // claim until now — this is the first point at which the real one is known.
    const size = Number(metadata.size ?? 0);
    const contentType = String(metadata.contentType ?? '');
    if (!ALLOWED_UPLOAD_TYPES[contentType] || size <= 0 || size > MAX_UPLOAD_BYTES) {
      await file.delete().catch(() => {});
      return NextResponse.json({ error: 'That file cannot be sent' }, { status: 400 });
    }

    const [fileUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_READ_TTL_MS,
    });

    const accountId = await resolveAccountId();
    const staged = await getOnlyFansClient().uploadMediaFromUrl(accountId, fileUrl);

    // Best-effort: the provider has the bytes, and a leftover object is a fan's
    // media in our bucket. A failed delete must not fail the send.
    await file.delete().catch(() => {});

    return NextResponse.json({ mediaId: staged.id });
  } catch (error) {
    if (error instanceof OnlyFansApiError) {
      return handleApiError(
        error,
        'POST /api/onlyfans/media/upload',
        error.status >= 500 ? 502 : error.status,
      );
    }
    return handleApiError(error, 'POST /api/onlyfans/media/upload');
  }
});
