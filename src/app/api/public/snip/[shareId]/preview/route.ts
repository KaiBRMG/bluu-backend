import { NextResponse } from 'next/server';
import { renderSnipPreview } from '@/lib/services/snipPreviewService';

/**
 * GET /api/public/snip/{shareId}/preview — the link-preview image (`og:image`)
 * for a shared snip: a ≤1200px JPEG of the still, with a play badge for a
 * recording. See `snipPreviewService` for why this is a re-encode rather than
 * a redirect to `/image` (WhatsApp drops previews over ~600 KB).
 *
 * **Unauthenticated by design**, with the same three rules as `/image`:
 *   • liveness is re-checked here (`resolveLiveSnipObject`), never assumed;
 *   • one 404 for every refusal, so a stranger cannot probe which tokens exist;
 *   • `no-store` on both outcomes. A CDN-cached preview would outlive the snip
 *     being deleted, and each chat platform caches its own copy anyway — the
 *     only requests this sees are the handful of unfurls per paste.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;

  const jpeg = await renderSnipPreview(shareId).catch((error) => {
    // Never log the id — it is the share token (snipping-tool.md) — and a GCS
    // or sharp message can carry the object path, which contains it.
    const e = error as { name?: string; code?: unknown };
    console.error('[snip preview] render failed:', e?.name, e?.code);
    return null;
  });
  if (!jpeg) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return new NextResponse(new Uint8Array(jpeg), {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(jpeg.length),
      'Cache-Control': 'no-store',
      // The token is in the path; keep it out of any search index that
      // follows an og:image, same posture as the page's robots meta.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
