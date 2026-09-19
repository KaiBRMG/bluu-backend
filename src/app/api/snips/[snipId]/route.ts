import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { deleteSnip, requireSnippingToolAccess } from '@/lib/services/snipService';

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
