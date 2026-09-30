import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  GROWTH_ACCOUNTS,
  checkGrowthAccess,
  currentDayKey,
  readGrowthSeries,
  serializeGrowthAccount,
  yearsBetween,
} from '@/lib/services/growthTrackingService';
import { dayKeysIn, rangeStart, type DayMap } from '@/lib/growth/metrics';
import { isGrowthAccountId } from '@/lib/growth/platform';
import { MAX_PINNED_GROWTH_ACCOUNTS } from '@/lib/growth/access';
import type { PinnedGrowthAccount } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/growth/pinned?ids=twitter_a,facebook_b — the home widget's data.
 *
 * ── Why not the page's `/series` payload ────────────────────────────────────
 * That is every account's whole history — tens of KB — and the widget draws at
 * most five 30-day sparklines. This reads exactly the pinned documents and
 * their current-year series — two `getAll`s, run together, since the series
 * refs come from the ids alone — and ships each account's
 * last 30 days projected down to the follower count: the figure, the delta and
 * the line are all the widget renders.
 *
 * ── Why the ids are in the URL ──────────────────────────────────────────────
 * The pins live on the user doc, so the server could read them itself — but
 * putting them in the query string makes the URL *change when the pins change*,
 * which is what lets this be browser-cached (rule 9i): `private, max-age` keyed
 * on a URL that stays valid for exactly as long as the pin set does. Readings
 * land nightly; fifteen minutes (the manual-refresh cooldown) bounds how long a
 * "Refresh now" can take to show here. `Vary: Authorization`
 * keeps a second person on the same machine from being served the first one's
 * response. `private` because it is behind auth — which also means no CDN.
 *
 * The ids are only a lookup, never a grant: access is the same page permission
 * as the rest of Growth Tracking, checked on every request.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const raw = request.nextUrl.searchParams.get('ids') ?? '';
    const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
    if (ids.length > MAX_PINNED_GROWTH_ACCOUNTS || !ids.every(isGrowthAccountId)) {
      return NextResponse.json({ error: 'Invalid account ids' }, { status: 400 });
    }

    const headers = {
      'Cache-Control': 'private, max-age=900',
      Vary: 'Authorization',
    };
    if (ids.length === 0) return NextResponse.json({ accounts: [] }, { headers });

    const from = rangeStart('30d');
    // Independent reads: a stale pin costs at most a missing series doc or two.
    const [docs, series] = await Promise.all([
      adminDb.getAll(...ids.map((id) => adminDb.collection(GROWTH_ACCOUNTS).doc(id))),
      readGrowthSeries(ids, yearsBetween(from, currentDayKey())),
    ]);
    const found = docs.filter((d) => d.exists).map(serializeGrowthAccount);
    const daysById = new Map(series.map((s) => [s.accountId, s.days]));

    // Pin order, not document order — the widget lists them as they were pinned.
    const byId = new Map(found.map((a) => [a.id, a]));
    const accounts: PinnedGrowthAccount[] = ids
      .map((id) => byId.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => {
        const all = daysById.get(a.id) ?? {};
        const days: DayMap = {};
        for (const key of dayKeysIn(all, from)) days[key] = { followers: all[key].followers };
        return {
          id: a.id,
          platform: a.platform,
          handle: a.handle,
          profilePictureUrl: a.profilePictureUrl,
          isActive: a.isActive,
          lastScrapeStatus: a.lastScrapeStatus,
          lastScrapeError: a.lastScrapeError,
          consecutiveFailures: a.consecutiveFailures,
          days,
        };
      });

    return NextResponse.json({ accounts }, { headers });
  } catch (error) {
    return handleApiError(error, 'GET /api/smm/growth/pinned');
  }
});
