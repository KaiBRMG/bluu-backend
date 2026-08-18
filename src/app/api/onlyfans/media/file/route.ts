import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireOnlyFansAccess } from '@/lib/services/onlyfansService';
import { resolveMediaVariant, invalidateMediaVariant } from '@/lib/services/onlyfansMediaCache';
import { mediaErrorCode } from '../../_lib/mediaErrors';
import { OnlyFansApiError, resolveAccountId } from '@/lib/onlyfans';
import { LARGE_MEDIA_VARIANTS, type OFMediaVariant } from '@/lib/onlyfans/types';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * A source-resolution video is routinely 100–250MB, and this route streams it
 * from the provider into our bucket before answering. Vercel's ceiling on a
 * Node function; even the largest attachment seen needs well under it, since a
 * copy that cannot manage ~1MB/s has other problems.
 */
export const maxDuration = 300;

/**
 * POST /api/onlyfans/media/file — resolve one **large** rendition.
 *
 * Split from `/media/resolve` because the two have nothing in common
 * operationally. That route is a viewport-driven batch of preview images with a
 * short budget; this one is a single deliberate act — an operator pressed play —
 * that may hold a connection open for minutes while a few hundred megabytes are
 * copied.
 *
 * **The provider is billed at most once per file here, ever.** The renderer is
 * never given the metered `dl.fansapi.com` URL, because a `<video>` element
 * re-requests ranges on every seek and each one would be another stream through
 * the meter. What comes back always points at Cloud Storage or at the provider's
 * own free CDN.
 *
 * The caller is expected to have chosen the cheapest rendition that will do:
 * `video720` is typically a small fraction of `full`, and on this provider's
 * pricing that is the difference between tens of credits and hundreds.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const variant = body?.variant as OFMediaVariant;
  const url = typeof body?.url === 'string' && body.url ? body.url : null;

  if (!id || !LARGE_MEDIA_VARIANTS.includes(variant)) {
    return NextResponse.json(
      { error: `variant must be one of ${LARGE_MEDIA_VARIANTS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const accountId = await resolveAccountId();

    // A retry after the renderer failed to load what we last gave it. Dropping
    // the memo makes the next lookup re-sign (or re-fetch); it never re-bills a
    // file that is already in the bucket, because the storage check comes first.
    if (body?.refresh === true) invalidateMediaVariant(accountId, id, variant);

    const { url: resolved, ttlMs, source } = await resolveMediaVariant({
      accountId,
      mediaId: id,
      variant,
      sourceUrl: url,
      large: true,
    });

    return NextResponse.json({ url: resolved, ttlMs, source });
  } catch (error) {
    const code = mediaErrorCode(error);
    if (code !== 'failed') {
      return NextResponse.json({ error: code }, { status: code === 'expired' ? 410 : 404 });
    }
    if (error instanceof OnlyFansApiError) {
      return handleApiError(
        error,
        'POST /api/onlyfans/media/file',
        error.status >= 500 ? 502 : error.status,
      );
    }
    return handleApiError(error, 'POST /api/onlyfans/media/file');
  }
});
