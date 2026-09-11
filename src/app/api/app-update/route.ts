import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { APP_UPDATE, resolveAppUpdateConfigFor } from '@/lib/appUpdateConfig';

/**
 * The live update policy, served to a running renderer — already resolved to
 * the caller.
 *
 * `src/lib/appUpdateConfig.ts` is still the single gate; this route only hands
 * the result to a client whose **bundle** may be days old. Electron picks up a
 * new Vercel deploy on a full page load, which a user who never quits the app
 * never performs; without this they would keep evaluating the config as it stood
 * when they launched. See `UpdateAvailableBanner`.
 *
 * **The cohort match happens here, not on the client** — same reasoning as
 * `/api/announcements`. The `uids`/`groups` lists name colleagues, and a
 * renderer needs none of that to draw a banner it has already been told applies
 * to it. A platform the caller is not targeted by comes back as `null`, which is
 * exactly what a disarmed platform looks like: the client cannot tell "not for
 * your OS" from "not for you", and has no reason to.
 *
 * **Auth is optional, and that is the point.** A Bearer token lets the route
 * narrow to that user; without one it falls back to `allUsers` entries only
 * (`resolveAppUpdateConfigFor(config, null)`) — the pre-cohort behaviour and the
 * only safe answer for a caller it cannot identify. So the route keeps its
 * original property of answering a client whose session is not the point, while
 * a pilot cohort stays invisible to anyone outside it. A bad or expired token is
 * treated as no token, never a 401: locking a stale renderer out of the update
 * policy is how a fleet gets stranded on a broken build.
 *
 * Still no user data in the response: a public version number and the public
 * `/download` URL, the same facts as the GitHub release. The one read
 * (`getUserById`, 60s cached) only happens for an authenticated caller, on a
 * route the banner hits at mount and at clock-out (rule 9).
 *
 * No `export const dynamic`: the project runs with `cacheComponents`, which
 * rejects that segment config outright (build error) because the model is
 * inverted — handlers are dynamic unless they opt into `'use cache'`. The
 * `no-store` header below is what keeps a proxy from holding the answer.
 */
export async function GET(request: NextRequest) {
  let audience: { uid: string; groups: string[] } | null = null;

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = await adminAuth.verifyIdToken(authHeader.slice(7));
      const user = await getUserById(token.uid);
      audience = { uid: token.uid, groups: user?.groups ?? [] };
    } catch {
      // Unverifiable token → treated as anonymous. Deliberately silent and
      // non-fatal: the caller still gets the fleet-wide policy.
      audience = null;
    }
  }

  return NextResponse.json(resolveAppUpdateConfigFor(APP_UPDATE, audience), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
