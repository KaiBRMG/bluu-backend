/**
 * GET /api/fans/lookup?q&creatorId — the custom-request wizard's fan search.
 *
 * Open to whoever may raise a custom or a campaign (`ca-custom-requests`,
 * `ca-campaigns`, `creators-custom-requests`) — the same people who already
 * read every custom, fan name included. Returns a handful of hits, enough to
 * recognise the right fan; the full picture is the fan report.
 *
 * `no-store`: a fan named a moment ago in another custom must be findable now.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getUserById } from '@/lib/services/userService';
import { lookupFans } from '@/lib/services/fanBaseService';
import type { DecodedIdToken } from 'firebase-admin/auth';

const WIZARD_PAGES = ['ca-custom-requests', 'ca-campaigns', 'creators-custom-requests'];

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    if (token.admin !== true) {
      const caller = await getUserById(token.uid);
      if (!WIZARD_PAGES.some(id => caller?.permittedPageIds?.includes(id))) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }
    const { searchParams } = new URL(request.url);
    const hits = await lookupFans({
      q: (searchParams.get('q') ?? '').slice(0, 200),
      creatorId: searchParams.get('creatorId') || null,
    });
    return NextResponse.json({ hits }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleApiError(err, 'fans/lookup GET');
  }
});
