import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { ensurePromptShare, revokePromptShare } from '@/lib/services/promptLibraryService';
import { promptShareUrl } from '@/lib/promptShareUrl';
import { PAGE_ID } from '../../route';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/prompt-library/[id]/share
 *
 * Mints (or returns) the prompt's public share token and the URL built from it.
 * Idempotent — "Copy link" twice gives the same link, so a link already sent to
 * someone keeps resolving.
 *
 * Tier 2, the `apps-prompt-library` page permission: sharing a prompt is an
 * ordinary act by anyone who can already read and edit the library, in the same
 * class as archiving. It is not an authorisation-graph change, so it does not
 * need the admin claim — but it IS the act that puts prompt text on the open
 * internet, which is why it is explicit and revocable rather than automatic.
 */
export const POST = withAuth(async (
  _req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    const denied = await checkPageAccess(token.uid, PAGE_ID);
    if (denied) return denied;

    const { id } = await params;
    const shareId = await ensurePromptShare(id, token.uid);
    if (!shareId) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });

    return NextResponse.json({ shareId, url: promptShareUrl(shareId) });
  } catch (err) {
    return handleApiError(err, 'prompt-library share POST');
  }
});

/**
 * DELETE /api/prompt-library/[id]/share
 *
 * Withdraws the public link. The token is destroyed, not parked — re-sharing
 * later mints a new one, so a link that has been revoked is dead for good.
 */
export const DELETE = withAuth(async (
  _req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    const denied = await checkPageAccess(token.uid, PAGE_ID);
    if (denied) return denied;

    const { id } = await params;
    const ok = await revokePromptShare(id);
    if (!ok) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'prompt-library share DELETE');
  }
});
