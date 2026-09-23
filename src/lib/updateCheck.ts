/**
 * Client side of the **manual** update check — the "Check for Update" item in
 * the user menu.
 *
 * Separate from [`appUpdateConfig.ts`](appUpdateConfig.ts) on purpose, because
 * the two answer different questions and only one of them is a policy:
 *
 * - `APP_UPDATE` decides who gets **pushed** an update — forced (`compulsory`)
 *   or as the persistent dismissible card `UpdateAvailableBanner` draws. A
 *   platform reads `null` there most of the time, which means "nobody is being
 *   nudged", not "there is nothing newer".
 * - This asks **what has actually been released**, from the GitHub releases feed
 *   via `/api/app-update/latest`. It is the honest answer to a user who pressed
 *   a button asking whether they are up to date, and it is available on Windows
 *   and macOS alike — unlike `electron-updater`, which only runs on macOS.
 *
 * Deliberately **not** memoised across calls: pressing Check for Update again is
 * a request to look again. The CDN and the route's own module cache absorb the
 * repeat (see the route header), so a re-press costs the fleet nothing.
 */
/** The `/api/app-update/latest` response. Declared here rather than in the route
 *  so a client component can import the shape without importing a module that
 *  pulls in `next/server`. */
export interface LatestReleaseResponse {
  /** Semver with no `v` prefix (`0.14.2`), or null when the check failed. */
  version: string | null;
  /** ISO timestamp of publication, or null. */
  publishedAt: string | null;
  /** The release page, for a "what's new" link. Null when unknown. */
  releaseUrl: string | null;
  status: 'ok' | 'unavailable';
}

const UNAVAILABLE: LatestReleaseResponse = {
  version: null,
  publishedAt: null,
  releaseUrl: null,
  status: 'unavailable',
};

/**
 * The newest published release, or an `unavailable` answer.
 *
 * Never throws and never guesses: every failure path — offline, a stale renderer
 * calling a route that did not exist when it launched, a rate-limited GitHub —
 * lands on `unavailable`, which the dialog renders as "couldn't check" rather
 * than as "you're up to date".
 */
export async function fetchLatestRelease(): Promise<LatestReleaseResponse> {
  try {
    const res = await fetch('/api/app-update/latest', { cache: 'no-store' });
    if (!res.ok) return UNAVAILABLE;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return UNAVAILABLE;
    const v = data as Record<string, unknown>;
    if (typeof v.version !== 'string' || !v.version) return UNAVAILABLE;
    return {
      version: v.version,
      publishedAt: typeof v.publishedAt === 'string' ? v.publishedAt : null,
      releaseUrl: typeof v.releaseUrl === 'string' ? v.releaseUrl : null,
      status: 'ok',
    };
  } catch {
    return UNAVAILABLE;
  }
}
