import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import {
  goLoginErrorResponse,
  listGoLoginProfilesForUser,
  requireGoLogin,
} from '@/lib/services/gologinService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/gologin/profiles — the profiles **this operator** can see.
 *
 * Read with their own personal GoLogin token, so the set is whatever GoLogin has
 * shared into their account — there is no server-side filter to get wrong, and a
 * bug here can only ever show *fewer* profiles, never more.
 *
 * A user who has not linked an account yet gets **428** with `code: 'not-linked'`,
 * which the window turns into the onboarding flow. That is deliberately not a
 * 403: "you have not set this up" and "you are not allowed" are different facts
 * and lead to different screens.
 *
 * `?refresh=1` is the operator's refresh button and bypasses the service's 60s
 * memo (but not its 15s floor — see `gologinService.ts`; a 429 from GoLogin
 * revokes the API token permanently, so nothing here may be spammable).
 */
export const maxDuration = 60;

export const GET = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLogin(token.uid);
  if (denied) return denied;

  const force = req.nextUrl.searchParams.get('refresh') === '1';
  try {
    const { profiles, total, truncated, fetchedAtMs } = await listGoLoginProfilesForUser(
      token.uid,
      force,
    );
    return NextResponse.json({ profiles, total, truncated, fetchedAtMs });
  } catch (err) {
    return goLoginErrorResponse(err, 'load your GoLogin profiles');
  }
});
