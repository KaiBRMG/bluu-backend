import { NextResponse } from 'next/server';
import { TERMS_VERSION } from '@/lib/terms';

/**
 * The Terms of Use version this deployment publishes.
 *
 * Read over HTTP, never compiled into the client, because the Electron renderer
 * can run a weeks-old bundle (rule 9c) and a policy flag it carried inside
 * itself could never reach it. `TermsUpdateSignOut` asks this only at the moment
 * it is about to act — a clocked-out, idle session — so it is not a poll.
 *
 * Unauthenticated: a version number is not user data, and the answer must be
 * available to a client whose session is not the point.
 *
 * Cacheability (rule 9i): the value is constant for the life of a deployment and
 * identical for every caller, so the CDN answers it. A new deployment is a new
 * cache, and a few minutes of staleness is irrelevant to a sign-out that only
 * fires after a period of inactivity anyway.
 */
export async function GET() {
  return NextResponse.json(
    { version: TERMS_VERSION },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300',
      },
    },
  );
}
