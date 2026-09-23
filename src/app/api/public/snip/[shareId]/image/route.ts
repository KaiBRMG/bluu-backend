import { NextResponse } from 'next/server';
import { getSnipMediaRedirect } from '@/lib/services/snipService';

/**
 * GET /api/public/snip/{shareId}/image — the snip's **still**, for anyone
 * holding the link: the capture itself for an image snip, the poster frame for
 * a recording.
 *
 * The recording's own bytes are served by the sibling `/video` route, not by a
 * parameter here. This URL is the one already sitting in Slack unfurls, browser
 * caches and OG previews for every snip ever shared, so what it means must not
 * shift underneath them — and a recording with no poster 404s here exactly like
 * any other refusal.
 *
 * **It redirects; it does not stream.** A 302 to a freshly signed Cloud Storage
 * URL means the megabytes travel bucket → recipient and never bucket → function
 * → recipient (rule 9i). Proxying the object through here would bill every view
 * as Fast Origin Transfer twice over, for bytes we have no reason to touch.
 *
 * **Why the indirection exists at all**, rather than putting the signed URL
 * straight in the page's `<img src>`: a signed URL expires, and this one is the
 * URL a recipient's browser caches, a Slack unfurl fetches, and an OG preview
 * points at. A stable path that re-signs per request is permanent to the outside
 * and revocable from the inside — deleting the snip kills it instantly, where a
 * handed-out signed URL would keep working until its own expiry.
 *
 * **Unauthenticated by design**, exactly like `/p/[shareId]`: the share token
 * in the path *is* the access control. Three things follow, and all three are
 * load-bearing:
 *   • `getSnipMediaRedirect` re-checks liveness itself — this endpoint is
 *     reachable without the page, so it cannot lean on the page having checked.
 *   • One 404 for every refusal (unknown, deleted, pending, expired), so a
 *     stranger cannot probe which tokens exist.
 *   • `no-store` on the redirect itself. The *target* is short-lived, so a
 *     cached 302 would outlive the URL it points at and serve a broken image —
 *     and a cached redirect would also survive the snip being deleted, which is
 *     the one thing deletion has to be able to stop.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;

  const url = await getSnipMediaRedirect(shareId, 'still').catch(() => null);
  if (!url) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  });
}
