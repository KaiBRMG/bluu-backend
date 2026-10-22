import { NextResponse } from 'next/server';
import { isInstallerPlatform } from '@/lib/installers';
import { getLatestInstallers, RELEASES_PAGE_URL } from '@/lib/installerReleases';

/**
 * `GET /api/download/{windows | mac-arm | mac-intel}` — the stable link behind
 * every download button. A 302 to the newest published installer for that
 * platform on GitHub Releases; the file itself never crosses Vercel (rule 9i).
 * See `installerReleases.ts` for how "newest" is decided.
 *
 * Unauthenticated: it hands out what the public releases page already does, and
 * its readers (a new colleague, an old Windows shell's update prompt in the
 * system browser) have no session. `/api` is outside the middleware matcher, so
 * no allowlist entry is needed.
 *
 * ▸ **Cacheable at the CDN.** The answer is identical for everyone, so a short
 *   `s-maxage` lets one origin hit serve every click; five minutes is the most a
 *   new release can be invisible here, on top of the module memo.
 * ▸ **Never a dead link.** No release carrying the file, or GitHub unreachable,
 *   lands on the releases page rather than an error — and is not cached, so the
 *   next click retries.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  if (!isInstallerPlatform(platform)) {
    return NextResponse.json({ error: 'Unknown platform' }, { status: 404 });
  }

  const asset = (await getLatestInstallers())[platform];
  if (!asset) {
    return NextResponse.redirect(RELEASES_PAGE_URL, {
      status: 302,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.redirect(asset.url, {
    status: 302,
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' },
  });
}
