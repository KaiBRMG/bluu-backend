import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { resolveSnipKind } from '@/lib/snips';
import {
  SnipQuotaError,
  createSnipUploadSlot,
  requireSnippingToolAccess,
} from '@/lib/services/snipService';

/**
 * POST /api/snips/upload-url — reserve a snip and sign the slot its PNG goes in.
 *
 * Leg one of two. The renderer PUTs the capture straight to Cloud Storage with
 * the returned URL and then calls `POST /api/snips` to finalise; the bytes never
 * cross Vercel (rule 9i). A full-screen PNG is several megabytes and the only
 * place it is going is a bucket.
 *
 * **No `Cache-Control`, and it must stay that way** (rule 9i): every call mints a
 * new id and a new signature. A cached response would hand two captures the same
 * storage path and the same share link.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireSnippingToolAccess(token.uid);
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => null);
    // The kind decides the content type the signature pins, the object's
    // extension, the byte ceiling, and whether a second slot is signed for the
    // poster — so it is resolved once here and never re-read from the finalise
    // call, which reads it back off the reservation instead.
    const slot = await createSnipUploadSlot(
      token.uid,
      Number(body?.bytes),
      resolveSnipKind(body?.kind),
    );
    if (!slot) {
      return NextResponse.json({ error: 'That capture is not a valid size' }, { status: 400 });
    }
    return NextResponse.json(slot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof SnipQuotaError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return handleApiError(error, 'POST /api/snips/upload-url');
  }
});
