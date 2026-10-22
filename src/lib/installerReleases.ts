import 'server-only';
import type { InstallerPlatform } from './installers';

/**
 * Which file on the GitHub releases page is "the latest installer" for each
 * platform — the lookup behind `/api/download/[platform]` and `/api/download`.
 *
 * ▸ **Why not GitHub's own `/releases/latest/download/<name>` link.** That URL
 *   only works for an asset whose name never changes, and electron-builder puts
 *   the version in every file name (`Bluu-Backend-Setup-1.0.2.exe`). Renaming
 *   the artifacts would fix it, but only from the next build on — and the macOS
 *   `.dmg` names are also what the "which Mac" guidance describes.
 *
 * ▸ **Newest release that HAS the file, not the newest release.** The mac and
 *   Windows jobs publish to the same release independently, so a release can be
 *   public with only one platform's files on it — v1.0.1 shipped Windows only,
 *   and every release is half-published for the ~10–30 min one job outlives the
 *   other. Taking `/releases/latest` blindly would hand a Mac visitor nothing in
 *   that window. Walking back to the newest release that carries the file means
 *   a link is never dead, only occasionally one release behind.
 *
 * ▸ **The bytes never touch Vercel** (rule 9i). The routes 302 to GitHub's own
 *   download URL; this module only reads the release list.
 *
 * ▸ **Rate limits** — same three brakes as `/api/app-update/latest`: the CDN
 *   header on the routes, the module memo below, and an optional server-only
 *   `GITHUB_TOKEN`. Without a token GitHub allows 60 requests/hour per IP.
 */

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/KaiBRMG/bluu-backend/releases?per_page=15';

/** Where a visitor lands when no release carries their file (or GitHub is down). */
export const RELEASES_PAGE_URL = 'https://github.com/KaiBRMG/bluu-backend/releases/latest';

/** How long a warm lambda may reuse its own answer. Matches the routes' `s-maxage`. */
const MEMO_TTL_MS = 5 * 60 * 1000;

export interface InstallerAsset {
  /** Semver with no `v` prefix. */
  version: string;
  /** GitHub's direct download URL for the file. */
  url: string;
}

export type LatestInstallers = Record<InstallerPlatform, InstallerAsset | null>;

/**
 * File name → platform. The x64 `.dmg` carries **no** arch suffix
 * (`Bluu-Backend-1.0.2.dmg`), so Intel is "a `.dmg` that is not arm64" — never
 * the other way round. `.blockmap` files end in `.blockmap` and match nothing.
 */
const MATCHERS: Record<InstallerPlatform, (name: string) => boolean> = {
  windows: (name) => name.endsWith('.exe'),
  'mac-arm': (name) => name.endsWith('-arm64.dmg'),
  'mac-intel': (name) => name.endsWith('.dmg') && !name.includes('arm64'),
};

const EMPTY: LatestInstallers = { windows: null, 'mac-arm': null, 'mac-intel': null };

let memo: { at: number; value: LatestInstallers } | null = null;

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown }[];
}

/**
 * The newest installer per platform. Never throws: a failed lookup answers every
 * platform `null`, and is not memoised, so the next request actually retries.
 */
export async function getLatestInstallers(): Promise<LatestInstallers> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.value;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects an API request with no UA.
    'User-Agent': 'bluu-backend-download',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return EMPTY;
    const releases = (await res.json()) as GitHubRelease[];
    if (!Array.isArray(releases)) return EMPTY;

    const value: LatestInstallers = { ...EMPTY };
    // GitHub lists newest first. A token with push access also sees drafts —
    // those must never be handed out, and pre-releases aren't for staff either.
    for (const release of releases) {
      if (release.draft || release.prerelease) continue;
      const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/i, '') : '';
      if (!/^\d+\.\d+/.test(version)) continue;

      for (const platform of Object.keys(MATCHERS) as InstallerPlatform[]) {
        if (value[platform]) continue;
        const asset = release.assets?.find(
          (a) => typeof a.name === 'string' && MATCHERS[platform](a.name),
        );
        if (asset && typeof asset.browser_download_url === 'string') {
          value[platform] = { version, url: asset.browser_download_url };
        }
      }
      if (value.windows && value['mac-arm'] && value['mac-intel']) break;
    }

    memo = { at: Date.now(), value };
    return value;
  } catch {
    // Network failure, timeout, malformed JSON — all the same answer.
    return EMPTY;
  }
}
