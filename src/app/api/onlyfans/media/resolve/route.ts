import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireOnlyFansAccess, resolveMediaUrlCached } from '@/lib/services/onlyfansService';
import { resolveMediaVariant } from '@/lib/services/onlyfansMediaCache';
import { mediaErrorCode } from '../../_lib/mediaErrors';
import { OnlyFansApiError, resolveAccountId } from '@/lib/onlyfans';
import type { OFMediaVariant } from '@/lib/onlyfans/types';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Ceiling on one request. A batch exists to save round trips on a grid of
 * thumbnails, not to let one caller trigger an unbounded number of billed
 * provider downloads in a single shot.
 */
const MAX_ITEMS = 12;

/** The small renditions a tile renders itself with. Large ones use `/media/file`. */
const BATCH_VARIANTS: readonly OFMediaVariant[] = ['thumb', 'preview'];

/**
 * A copy into our bucket is a network hop with a file at the end of it, so the
 * batch needs more than a default lambda's ten seconds — but far less than the
 * file route, because nothing here is bigger than a preview image.
 */
export const maxDuration = 60;

/**
 * POST /api/onlyfans/media/resolve — turn attachment renditions into URLs the
 * renderer can actually load.
 *
 * `cdn*.onlyfans.com` is IP-locked to the provider's proxy, so no attachment can
 * be displayed without passing through here. The body is a batch because a
 * message with four photos would otherwise be four round trips.
 *
 * Requests name **`{ id, variant, url }`**, not a bare URL, and that is
 * load-bearing in two directions:
 *
 *  - the caches key on `id:variant`, which survives the provider re-signing its
 *    links on every history fetch — URL-keyed caching missed on every refresh
 *    and re-billed the whole viewport;
 *  - `url` is optional, so a message that arrived by webhook (metadata mirrored,
 *    links deliberately not) still renders whenever the file is already cached.
 *
 * Billed bytes are streamed into Cloud Storage once and served from there
 * afterwards — see `onlyfansMediaCache.ts`. Failures are reported **per item**
 * rather than failing the batch: one dead link should degrade its own tile, not
 * blank the other three beside it.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;

  const body = await request.json().catch(() => null);

  // TEMPORARY (renderer compatibility) — an OF Manager window opened before this
  // shipped posts `{ urls: [...] }` and knows nothing about ids or variants. It
  // keeps the old pass-through behaviour, including the old cost profile. Remove
  // once no client can still be running that bundle.
  if (!body?.items && Array.isArray(body?.urls)) {
    return legacyResolve(body.urls as unknown[]);
  }

  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'items is required' }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `At most ${MAX_ITEMS} items per request` }, { status: 400 });
  }

  const parsed: { id: string; variant: OFMediaVariant; url: string | null }[] = [];
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const variant = item?.variant as OFMediaVariant;
    if (!id || !BATCH_VARIANTS.includes(variant)) {
      return NextResponse.json(
        { error: 'Each item needs an id and a thumb/preview variant' },
        { status: 400 },
      );
    }
    parsed.push({ id, variant, url: typeof item?.url === 'string' && item.url ? item.url : null });
  }

  // Duplicates in one batch would each be a lookup; collapse them here so the
  // memo is not the only thing standing between a repeated tile and a bill.
  const unique = new Map<string, (typeof parsed)[number]>();
  for (const item of parsed) unique.set(`${item.id}:${item.variant}`, item);

  try {
    const accountId = await resolveAccountId();

    const entries = await Promise.all(
      [...unique].map(async ([key, item]) => {
        try {
          const { url, ttlMs } = await resolveMediaVariant({
            accountId,
            mediaId: item.id,
            variant: item.variant,
            sourceUrl: item.url,
            large: false,
          });
          return [key, { url, ttlMs }] as const;
        } catch (error) {
          return [key, { error: mediaErrorCode(error) }] as const;
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

/** TEMPORARY — see the call site. The pre-`items` contract, unchanged. */
async function legacyResolve(urls: unknown[]): Promise<NextResponse> {
  if (urls.length === 0 || urls.length > MAX_ITEMS) {
    return NextResponse.json({ error: 'urls is required' }, { status: 400 });
  }
  if (!urls.every((u) => typeof u === 'string' && u.length > 0)) {
    return NextResponse.json({ error: 'urls must be strings' }, { status: 400 });
  }

  const unique = [...new Set(urls as string[])];
  try {
    const accountId = await resolveAccountId();
    const entries = await Promise.all(
      unique.map(async (url) => {
        try {
          const { url: resolved, ttlMs } = await resolveMediaUrlCached(accountId, url);
          return [url, { url: resolved, ttlMs }] as const;
        } catch (error) {
          return [url, { error: mediaErrorCode(error) }] as const;
        }
      }),
    );
    return NextResponse.json({ resolved: Object.fromEntries(entries) });
  } catch (error) {
    return handleApiError(error, 'POST /api/onlyfans/media/resolve (legacy)');
  }
}
