import { NextResponse } from 'next/server';
import type { InstallerVersions } from '@/lib/installers';
import { getLatestInstallers } from '@/lib/installerReleases';

/**
 * `GET /api/download` — the version each `/download` button will hand over, so
 * the chip on the button is a fact read from the same lookup the button follows
 * (`/api/download/[platform]`), not a constant someone has to remember to bump.
 *
 * Versions only — the URLs stay behind the redirect route, which is the one
 * place that decides where a click goes. Public and identical for everyone, so
 * CDN-cached (rule 9i); a failed lookup (every platform `null`) is not cached.
 */
export async function GET() {
  const installers = await getLatestInstallers();
  const body: InstallerVersions = {
    windows: installers.windows?.version ?? null,
    'mac-arm': installers['mac-arm']?.version ?? null,
    'mac-intel': installers['mac-intel']?.version ?? null,
  };
  const found = Object.values(body).some(Boolean);

  return NextResponse.json(body, {
    headers: {
      'Cache-Control': found
        ? 'public, s-maxage=300, stale-while-revalidate=3600'
        : 'no-store',
    },
  });
}
