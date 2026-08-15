import { NextResponse } from 'next/server';

/**
 * The identity of the deployment currently serving production.
 *
 * Exists so a long-running Electron renderer can tell that the code it is
 * executing is older than the code being served. The shell never reloads on its
 * own — sleep/wake, clock-out and hours of idling are all designed to *survive*
 * without a page load — so a user who never quits the app can run a
 * weeks-old bundle against a current backend. `DeploymentRefresher` polls this
 * and reloads at a safe moment.
 *
 * **Returns `null` when the id can't be determined** (local dev, or a host that
 * doesn't set these). That is deliberately fail-safe: the client treats null as
 * "don't know, don't reload" rather than "changed". A value that varied per
 * request would put every client into a reload loop.
 *
 * Unauthenticated, like `/api/app-update`: an opaque deployment id is not user
 * data, and it must answer for a client whose session is not the point.
 */
export const dynamic = 'force-dynamic';

function currentDeploymentId(): string | null {
  return (
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    null
  );
}

export async function GET() {
  return NextResponse.json(
    { id: currentDeploymentId() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
