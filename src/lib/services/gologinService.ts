/**
 * GoLogin service — authorization, and the one place the provider is paged.
 *
 * The whole feature is a read: "show me every browser profile". What makes it
 * worth a service rather than a route body is the **rate limit**, which GoLogin
 * enforces by permanently revoking the API token on a 429 (see the header of
 * `providers/gologinApi.ts`). Listing every profile is inherently N requests, so
 * the walk is bounded, memoised, de-duplicated in flight, and floor-limited even
 * when the operator asks for a refresh.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import {
  getGoLoginClient,
  GoLoginApiError,
  PROFILES_PER_PAGE,
  type GoLoginProfile,
} from '@/lib/gologin';

/** Page permission that gates every GoLogin surface. */
export const GOLOGIN_PAGE_ID = 'apps-gologin';

/**
 * Tier-2 gate for every GoLogin route. Returns a 403 response when denied,
 * null when allowed — same contract as `checkPageAccess`.
 */
export function requireGoLoginAccess(uid: string): Promise<NextResponse | null> {
  return checkPageAccess(uid, GOLOGIN_PAGE_ID);
}

/** How long a listing is served without touching the provider at all. */
const CACHE_TTL_MS = 60 * 1000;

/**
 * The floor under `?refresh=1`. A refresh costs one request per 30 profiles, so
 * a held-down button is the realistic way to reach 429 — and 429 here is not a
 * throttle, it is the token being destroyed. Inside this window a refresh
 * silently serves the memo.
 */
const FORCE_MIN_INTERVAL_MS = 15 * 1000;

/**
 * Hard stop on the walk: 40 pages × 30 = 1200 profiles. A bound is required, not
 * defensive dressing — a provider that kept returning full pages would otherwise
 * loop until the token is revoked.
 */
const MAX_PAGES = 40;

export interface GoLoginProfileList {
  profiles: GoLoginProfile[];
  /** The provider's own count, which can exceed `profiles.length` at the cap. */
  total: number;
  /** True when MAX_PAGES stopped the walk before the provider ran out. */
  truncated: boolean;
  fetchedAtMs: number;
}

let cached: GoLoginProfileList | null = null;
/** In-flight walk, so two operators opening the window make one set of calls. */
let inFlight: Promise<GoLoginProfileList> | null = null;

async function walkProfiles(): Promise<GoLoginProfileList> {
  const client = getGoLoginClient();
  const profiles: GoLoginProfile[] = [];
  const seen = new Set<string>();
  let total = 0;
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    // Strictly sequential. Fanning these out with Promise.all is what turns a
    // large workspace into a burst the provider counts against the minute.
    const result = await client.listProfiles(page);
    total = result.total;
    for (const profile of result.profiles) {
      // Ids repeat if a profile moves between pages mid-walk.
      if (seen.has(profile.id)) continue;
      seen.add(profile.id);
      profiles.push(profile);
    }
    if (result.profiles.length < PROFILES_PER_PAGE) break;
    if (page === MAX_PAGES) truncated = true;
  }

  return { profiles, total: Math.max(total, profiles.length), truncated, fetchedAtMs: Date.now() };
}

/**
 * Every profile in the workspace.
 *
 * `force` is the operator's refresh button; it bypasses the TTL but not the
 * floor above, and never the in-flight de-duplication.
 */
export async function listGoLoginProfiles(force = false): Promise<GoLoginProfileList> {
  const now = Date.now();
  if (cached) {
    const age = now - cached.fetchedAtMs;
    if (force ? age < FORCE_MIN_INTERVAL_MS : age < CACHE_TTL_MS) return cached;
  }
  if (inFlight) return inFlight;

  inFlight = walkProfiles()
    .then((result) => {
      cached = result;
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Maps an adapter error onto the response the route should send. */
export function goLoginErrorResponse(err: unknown): NextResponse {
  if (err instanceof GoLoginApiError) {
    console.error('[gologin]', err.status, err.message);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('[gologin] unexpected error', err);
  return NextResponse.json({ error: 'Could not load GoLogin profiles.' }, { status: 500 });
}
