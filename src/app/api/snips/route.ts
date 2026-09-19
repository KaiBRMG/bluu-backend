import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  finalizeSnip,
  listSnipPage,
  requireSnippingToolAccess,
  SNIP_PAGE_SIZE,
} from '@/lib/services/snipService';

/**
 * GET /api/snips?limit=24&cursor=<opaque> — one page of the caller's own snips,
 * newest first, plus the cursor for the next one.
 *
 * **Paged, not whole** (rule 9i). The full library is up to five hundred rows,
 * and each row's preview is a further origin request, so shipping the lot to
 * render two screens of grid is the expensive shape. `total` comes back on the
 * first page only — the count the grid needs once, not on every scroll.
 *
 * **`no-store`, deliberately** (rule 9i asks every route to declare itself). The
 * response is a list of live share links that a delete has to remove from the
 * page immediately; a `max-age` here would serve a grid still offering a link
 * that no longer resolves, which is worse than an origin round-trip. The page
 * fetches a page on mount, a page per scroll, and nothing on a poll.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireSnippingToolAccess(token.uid);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get('limit'));
    const page = await listSnipPage(token.uid, {
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : SNIP_PAGE_SIZE,
      cursor: searchParams.get('cursor'),
    });
    return NextResponse.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'GET /api/snips');
  }
});

/**
 * POST /api/snips — leg two: turn a reservation whose bytes have landed into a
 * live, linkable snip.
 *
 * The body carries only the id and the capture's pixel dimensions. The byte size
 * is read from the bucket rather than believed from the caller, which also
 * doubles as the proof the PUT actually happened — see `finalizeSnip`.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireSnippingToolAccess(token.uid);
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => null);
    const snip = await finalizeSnip(
      token.uid,
      String(body?.id ?? ''),
      Number(body?.width),
      Number(body?.height),
    );
    // One refusal for every cause — unknown id, someone else's reservation, an
    // upload that never landed. The id is a share token; a route that says which
    // of those it was is a route that confirms tokens exist.
    if (!snip) {
      return NextResponse.json({ error: 'That capture could not be saved' }, { status: 400 });
    }
    return NextResponse.json({ snip }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'POST /api/snips');
  }
});
