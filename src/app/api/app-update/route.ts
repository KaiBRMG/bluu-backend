import { NextResponse } from 'next/server';
import { APP_UPDATE } from '@/lib/appUpdateConfig';

/**
 * The live update policy, served to a running renderer.
 *
 * `src/lib/appUpdateConfig.ts` is still the single gate — this route only hands
 * the same constant to a client whose **bundle** may be days old. Electron picks
 * up a new Vercel deploy on a full page load, which a user who never quits the
 * app never performs; without this they would keep evaluating the config as it
 * stood when they launched. See `UpdateAvailableBanner`.
 *
 * Unauthenticated on purpose: it returns a public version number and the public
 * `/download` URL — the same facts as the GitHub release and the download page —
 * and it must answer for a client whose session is not the point. No user data,
 * no reads, no writes.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(APP_UPDATE, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
