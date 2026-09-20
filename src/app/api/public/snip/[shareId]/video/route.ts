import { NextResponse } from 'next/server';
import { getSnipMediaRedirect } from '@/lib/services/snipService';

/**
 * GET /api/public/snip/{shareId}/video — the recording itself, for anyone
 * holding the link.
 *
 * Everything the sibling `/image` route does and for the same reasons: a 302 to
 * a freshly signed Cloud Storage URL, so the bytes travel bucket → recipient
 * and never bucket → function → recipient (rule 9i). That matters more here
 * than it does for a still — a recording is tens of megabytes where a
 * screenshot is one or two, and proxying it would bill every play twice over.
 *
 * **Unauthenticated by design**, exactly like `/image` and `/p/[shareId]`: the
 * 160-bit token in the path *is* the access control. `getSnipMediaRedirect`
 * re-checks liveness itself, and every refusal — unknown token, deleted,
 * pending, expired, or an image snip asked for its video — is the same 404, so
 * a stranger cannot probe which tokens exist or what kind they are.
 *
 * ## `no-store`, knowing what it costs
 *
 * A `<video>` does not fetch its source once. It follows this redirect, and
 * then the browser issues **range requests** as the viewer plays and seeks —
 * and a browser re-resolves the original URL rather than reusing the target of
 * an uncacheable redirect, so each of those is another invocation of this
 * function. That is a real cost and it is accepted deliberately:
 *
 *   • The bodies never cross Vercel. What repeats is a header-only 302 —
 *     expensive in invocations, negligible in Fast Origin Transfer, which is
 *     the metric rule 9i is actually about.
 *   • Caching the redirect would break the one guarantee the indirection
 *     exists for. The target is a signed URL with its own hour-long life; a
 *     cached 302 would outlive it and serve a broken player, and would keep
 *     resolving after the snip is deleted — which is precisely what deletion
 *     has to be able to stop, and matters more for a recording of someone's
 *     screen than for a screenshot of one.
 *
 * If the invocation count ever becomes the problem, the fix is a longer signed
 * read TTL plus an `s-maxage` strictly shorter than it, accepting a bounded
 * window where a deleted recording still plays. Do not reach for that without
 * deciding that window is acceptable.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;

  const url = await getSnipMediaRedirect(shareId, 'video').catch(() => null);
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
