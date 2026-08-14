import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireOnlyFansAccess, resolveMediaUrlCached } from '@/lib/services/onlyfansService';
import { OnlyFansApiError, resolveAccountId } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Ceiling on one request. A batch exists to save round trips on a grid of
 * thumbnails, not to let one caller trigger an unbounded number of billed
 * provider downloads in a single shot.
 */
const MAX_URLS = 12;

/**
 * POST /api/onlyfans/media/resolve — turn expiring provider CDN links into URLs
 * the renderer can actually load.
 *
 * `cdn*.onlyfans.com` is IP-locked to the provider's proxy, so no attachment can
 * be displayed without passing through here. The body is a batch because a
 * message with four photos would otherwise be four round trips; the provider
 * work is per URL either way.
 *
 * **This costs credits when the provider has not cached the file**, which is why
 * the client resolves on viewport rather than on load and prefers the preview
 * variant over the full one. Repeats inside one server instance are memoised.
 *
 * Failures are reported **per URL** rather than failing the batch: one expired
 * link should degrade its own tile, not blank the other three beside it.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const urls = Array.isArray(body?.urls) ? body.urls : null;
  if (!urls || urls.length === 0) {
    return NextResponse.json({ error: 'urls is required' }, { status: 400 });
  }
  if (urls.length > MAX_URLS) {
    return NextResponse.json({ error: `At most ${MAX_URLS} urls per request` }, { status: 400 });
  }
  if (!urls.every((u: unknown) => typeof u === 'string' && u.length > 0)) {
    return NextResponse.json({ error: 'urls must be strings' }, { status: 400 });
  }

  // Duplicates in one batch would each be a lookup; collapse them here so the
  // memo is not the only thing standing between a repeated tile and a bill.
  const unique = [...new Set(urls as string[])];

  try {
    const accountId = await resolveAccountId();

    // The URL shape itself is validated behind the adapter — knowing what a
    // provider CDN link looks like is provider-shaped knowledge, so an invalid
    // one arrives here as a per-URL failure rather than a route-level check.
    const entries = await Promise.all(
      unique.map(async (url) => {
        try {
          const { url: resolved, ttlMs } = await resolveMediaUrlCached(accountId, url);
          return [url, { url: resolved, ttlMs }] as const;
        } catch (error) {
          const expired = error instanceof OnlyFansApiError && error.status === 403;
          return [url, { error: expired ? 'expired' : 'failed' }] as const;
        }
      }),
    );

    return NextResponse.json({ resolved: Object.fromEntries(entries) });
  } catch (error) {
    if (error instanceof OnlyFansApiError) {
      return handleApiError(
        error,
        'POST /api/onlyfans/media/resolve',
        error.status >= 500 ? 502 : error.status,
      );
    }
    return handleApiError(error, 'POST /api/onlyfans/media/resolve');
  }
});
