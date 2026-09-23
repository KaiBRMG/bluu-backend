import { NextResponse } from 'next/server';
import type { LatestReleaseResponse } from '@/lib/updateCheck';

/**
 * **The truth about what has actually been released** — the newest published
 * GitHub release, read straight from the source that `electron-updater` itself
 * reads.
 *
 * This is the other half of the update story, and it answers a different
 * question from its sibling route:
 *
 * | Route | Question | Authored where |
 * |---|---|---|
 * | `/api/app-update` | "Is anyone being **prompted** to update?" (policy, per platform, per cohort) | [`appUpdateConfig.ts`](../../../../lib/appUpdateConfig.ts) |
 * | `/api/app-update/latest` (this) | "What is the newest build that **exists**?" (fact) | GitHub Releases |
 *
 * The distinction is the whole point of the **Check for Update** menu item. A
 * user who asks "am I up to date?" is asking the second question, and the config
 * cannot answer it: `APP_UPDATE.win` is `null` most of the time, and a `null`
 * entry means "nobody is being nudged", never "there is nothing newer". Answering
 * a manual check from the config would tell a Windows user on v0.12.0 that they
 * are current while v0.14.2 sits on the releases page. So the manual check reads
 * the releases feed and the config stays what it always was: the gate for
 * **forced** and **persistent dismissible** prompts (`UpdateAvailableBanner`).
 *
 * ▸ **`electron/package.json` is not the source either.** That file is the
 *   version of whatever is *checked in*, which is bumped before the tag is
 *   pushed and long before Actions finishes notarizing — the exact window
 *   cross-cutting rule 14 exists to protect. A release is real when its assets
 *   are on the releases page, which is precisely what this reads.
 *
 * ▸ **Drafts and pre-releases are excluded for free**: `/releases/latest` is
 *   documented as "the last non-draft, non-prerelease release", so an
 *   in-progress Actions run is invisible here until it publishes.
 *
 * ▸ **Unauthenticated, and deliberately so** (rule 9i). The response is a public
 *   version number — identical for every caller and already served to the world
 *   by GitHub — so it can carry `public, s-maxage`, and the CDN answers the whole
 *   fleet from one origin hit. A `withAuth` route could not: `private` cancels
 *   `s-maxage`, and each window checking on demand would be an origin round-trip.
 *   It leaks nothing that the releases page does not.
 *
 * ▸ **Rate limits are the real hazard, and there are three brakes.** GitHub's
 *   unauthenticated limit is 60 requests/hour **per IP**, and Vercel functions
 *   share egress addresses. So: the CDN header above, a module-level cache for a
 *   warm lambda, and — if `GITHUB_TOKEN` is set — an authenticated call at
 *   5,000/hour. The token is optional and server-only; without it the route
 *   still works, and a rate-limited answer degrades to `unavailable` rather than
 *   to a wrong version number.
 *
 * ▸ **It never guesses.** If GitHub cannot be reached the response is
 *   `{ version: null, status: 'unavailable' }` and the dialog says it could not
 *   check. Falling back to a compiled-in constant would be the one failure mode
 *   worth avoiding: telling a user they are up to date when nobody actually
 *   looked.
 */

const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/KaiBRMG/bluu-backend/releases/latest';

/** How long a warm lambda may reuse its own answer. Matches `s-maxage`. */
const MEMO_TTL_MS = 10 * 60 * 1000;

let memo: { at: number; body: LatestReleaseResponse } | null = null;

const UNAVAILABLE: LatestReleaseResponse = {
  version: null,
  publishedAt: null,
  releaseUrl: null,
  status: 'unavailable',
};

/** `v0.14.2` → `0.14.2`. GitHub tags carry the prefix; `app.getVersion()` does not. */
function stripTagPrefix(tag: string): string {
  return tag.replace(/^v/i, '').trim();
}

async function readLatestRelease(): Promise<LatestReleaseResponse> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.body;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects an API request with no UA.
    'User-Agent': 'bluu-backend-update-check',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return UNAVAILABLE;

    const data = (await res.json()) as {
      tag_name?: unknown;
      name?: unknown;
      published_at?: unknown;
      html_url?: unknown;
    };

    const tag =
      typeof data.tag_name === 'string' && data.tag_name
        ? data.tag_name
        : typeof data.name === 'string'
          ? data.name
          : '';
    const version = stripTagPrefix(tag);
    // A release whose tag isn't a version is not something we can compare
    // against `app.getVersion()` — treat it as no answer rather than a wrong one.
    if (!/^\d+\.\d+/.test(version)) return UNAVAILABLE;

    const body: LatestReleaseResponse = {
      version,
      publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
      releaseUrl: typeof data.html_url === 'string' ? data.html_url : null,
      status: 'ok',
    };
    memo = { at: Date.now(), body };
    return body;
  } catch {
    // Network failure, timeout, malformed JSON — all the same answer.
    return UNAVAILABLE;
  }
}

export async function GET() {
  const body = await readLatestRelease();

  return NextResponse.json(body, {
    headers: {
      'Cache-Control':
        body.status === 'ok'
          // Public and identical for everyone, so the CDN carries the fleet.
          // `stale-while-revalidate` is long: a release is weeks apart, and a
          // ten-minute-old version number is never the wrong answer to "am I up
          // to date?" in a way that matters.
          ? 'public, s-maxage=600, stale-while-revalidate=3600'
          // Never cache a failure — the next press should actually retry.
          : 'no-store',
    },
  });
}
