import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import {
  goLoginErrorResponse,
  listGoLoginProfiles,
  requireGoLoginAccess,
} from '@/lib/services/gologinService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/gologin/profiles — every browser profile in the workspace.
 *
 * `?refresh=1` is the operator's refresh button and bypasses the service's 60s
 * memo (but not its 15s floor — see `gologinService.ts`; a 429 from GoLogin
 * revokes the API token permanently, so nothing here may be spammable).
 *
 * The list is walked page by page server-side and returned whole: the window's
 * job is "show me all of them", and paging the *renderer* would put a second,
 * unbounded source of provider requests behind a scroll bar.
 */
export const maxDuration = 60;

export const GET = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccess(token.uid);
  if (denied) return denied;

  const force = req.nextUrl.searchParams.get('refresh') === '1';
  try {
    const { profiles, total, truncated, fetchedAtMs } = await listGoLoginProfiles(force);
    return NextResponse.json({ profiles, total, truncated, fetchedAtMs });
  } catch (err) {
    return goLoginErrorResponse(err);
  }
});
