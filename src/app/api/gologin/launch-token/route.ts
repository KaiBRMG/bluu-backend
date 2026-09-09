import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { requireGoLoginAccess } from '@/lib/services/gologinService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/gologin/launch-token — hands the GoLogin API token to the Electron
 * **main process** so it can launch a profile locally.
 *
 * ⚠ **Read this before touching it.** This is the one place the provider token
 * leaves the server, and that is a deliberate, load-bearing trade rather than an
 * oversight:
 *
 * - The GoLogin Node SDK launches **Orbita on the user's own machine**. Nothing
 *   running on Vercel can do that, so the token has to reach the desktop for the
 *   feature to exist at all.
 * - It is **never written to disk and never sent to a renderer.** Main fetches it
 *   at launch time, holds it in memory for the life of the session, and the
 *   preload bridge exposes no way to read it back.
 * - It is **not compiled into the app**, which is the alternative and a strictly
 *   worse one: a bundled key is extractable from the asar by anyone with a copy
 *   of the installer, forever, including ex-staff. This route hands it only to a
 *   caller holding a valid Firebase ID token **and** the `apps-gologin` page
 *   permission, so revoking that permission revokes the token's reach.
 * - **Residual risk, stated plainly:** a user who legitimately holds the page
 *   permission can recover the token from their own machine (an intercepting
 *   proxy would do it). That population is exactly the set of people already
 *   trusted to operate every profile in the workspace, so the token grants them
 *   nothing they could not already do — but rotate `GL_API_TOKEN` when someone
 *   in it leaves, the same way any shared credential is rotated.
 *
 * POST rather than GET so it is never cached, never replayed from history, and
 * never sits in a URL that could be logged.
 */
export const POST = withAuth(async (_req, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccess(token.uid);
  if (denied) return denied;

  const apiToken = process.env.GL_API_TOKEN;
  if (!apiToken) {
    return NextResponse.json({ error: 'GL_API_TOKEN is not configured.' }, { status: 503 });
  }

  return NextResponse.json({ token: apiToken }, { headers: { 'Cache-Control': 'no-store' } });
});
