import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  deleteSnip,
  requireSnippingToolAccess,
  updateSnipDetails,
} from '@/lib/services/snipService';

/**
 * DELETE /api/snips/{snipId} — withdraw a snip permanently.
 *
 * This is the manual half of retention, and it is a real delete: the object goes
 * from the bucket and the row from Firestore, so the link stops resolving for
 * everyone who holds it. There is no revoke-but-keep — a snip *is* its link.
 *
 * Ownership is enforced in the service against `ownerUid`, not by the page
 * permission alone. The id is unguessable, but "unguessable" is not an
 * authorisation check.
 */
export const DELETE = withAuth<{ snipId: string }>(
  async (_request: NextRequest, token: DecodedIdToken, params) => {
    const denied = await requireSnippingToolAccess(token.uid);
    if (denied) return denied;

    try {
      const { snipId } = await params;
      const deleted = await deleteSnip(token.uid, snipId);
      if (!deleted) {
        return NextResponse.json({ error: 'That snip could not be deleted' }, { status: 404 });
      }
      return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return handleApiError(error, 'DELETE /api/snips/[snipId]');
    }
  },
);

/**
 * PATCH /api/snips/{snipId} — give a snip a title and a description.
 *
 * Both are optional and both are written after the fact: a capture completes
 * without asking the user anything (that is the point of the tool), so the
 * library card is the first place there is to name one.
 *
 * **Both are shown on the public page.** That is deliberate and the dialog says
 * so — a shared link carrying its own caption is a link the recipient can act
 * on without a covering message — but it does mean this route is the one place
 * a user can put arbitrary text on an unauthenticated page. It is their own
 * text on their own snip, the values are normalised and length-capped server
 * side (`normaliseSnipTitle` / `normaliseSnipDescription`, not the dialog's
 * copy of them), and both render as text nodes, never as markup.
 *
 * Ownership is enforced in the service against `ownerUid`, like DELETE above.
 *
 * `no-store`: the response is the row the grid re-renders from, and it carries
 * a live share link.
 */
export const PATCH = withAuth<{ snipId: string }>(
  async (request: NextRequest, token: DecodedIdToken, params) => {
    const denied = await requireSnippingToolAccess(token.uid);
    if (denied) return denied;

    try {
      const { snipId } = await params;
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid details' }, { status: 400 });
      }

      // Only the keys the caller actually sent are forwarded, so a request that
      // names a title cannot silently clear a description it never mentioned.
      const patch: { title?: unknown; description?: unknown } = {};
      if ('title' in body) patch.title = body.title;
      if ('description' in body) patch.description = body.description;

      const snip = await updateSnipDetails(token.uid, snipId, patch);
      // One refusal for every cause — unknown id, someone else's row, a
      // reservation that never finalised. The id is a share token, so a route
      // that says which of those it was is a route that confirms tokens exist.
      if (!snip) {
        return NextResponse.json({ error: 'That snip could not be updated' }, { status: 404 });
      }
      return NextResponse.json({ snip }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return handleApiError(error, 'PATCH /api/snips/[snipId]');
    }
  },
);
