import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { requireGoLogin } from '@/lib/services/gologinService';
import { getGoLoginUserToken } from '@/lib/services/gologinAccountService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/gologin/launch-token — hands **the caller's own** GoLogin API token
 * to the Electron main process so it can launch a profile locally.
 *
 * ⚠ **Read this before touching it.**
 *
 * - The GoLogin Node SDK launches **Orbita on the user's own machine**. Nothing
 *   running on Vercel can do that, so a token has to reach the desktop for the
 *   feature to exist at all.
 * - **It is the caller's personal token, never the master `GL_API_TOKEN`.** That
 *   is the whole point of the per-user model: what leaves the server is a
 *   credential to *one operator's own free GoLogin account*, which can see only
 *   what has been shared into it. The workspace key stays server-side, used only
 *   for folder administration. Do not "simplify" this back to a shared token.
 * - It is **never written to disk and never sent to a renderer.** Main fetches it
 *   at launch time, holds it in memory for the life of the session, and the
 *   preload bridge exposes no way to read it back.
 * - It is **fetched per launch, not cached**, so both gates — the `apps-gologin`
 *   page permission and the existence of the account row — are re-checked
 *   server-side every time. Revoking either stops the next launch rather than
 *   the next app start.
 *
 * POST rather than GET so it is never cached, never replayed from history, and
 * never sits in a URL that could be logged.
 */
export const POST = withAuth(async (_req, token: DecodedIdToken) => {
  const denied = await requireGoLogin(token.uid);
  if (denied) return denied;

  const apiToken = await getGoLoginUserToken(token.uid);
  if (!apiToken) {
    // 428, matching the profiles route: the remedy is onboarding, not access.
    return NextResponse.json(
      { error: 'No GoLogin account is linked to this user.', code: 'not-linked' },
      { status: 428 },
    );
  }

  return NextResponse.json({ token: apiToken }, { headers: { 'Cache-Control': 'no-store' } });
});
