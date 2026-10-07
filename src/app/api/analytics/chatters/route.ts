/**
 * GET /api/analytics/chatters?period=mtd|prev-month|7d|30d|custom[&from&to]
 *
 * Chatter Analytics (`ca-chatter-analytics`). An agent gets their own figures,
 * their daily trend and an **anonymous** team benchmark — no colleague's id or
 * name crosses the wire, and with fewer than three active agents there is no
 * benchmark at all (D8). `ca-admin` also gets the named leaderboard, BuddyX
 * online time against Bluu clocked-in time, and rostered agents who were never
 * online.
 *
 * Firestore only; the API is never called on a page read.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess, ANALYTICS_CACHE_HEADERS } from '@/lib/buddyx/analyticsAuth';
import { CHATTER_PERIODS, type ChatterPeriod } from '@/lib/buddyx/analyticsTypes';
import { getChatterAnalytics } from '@/lib/services/buddyxAnalyticsService';
import { isDayKey } from '@/lib/salary/salaryDate';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** A custom range sums days; past this it stops being a page and becomes a report. */
const MAX_CUSTOM_DAYS = 92;

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const access = await analyticsAccess(token, 'ca-chatter-analytics');
    if (access instanceof NextResponse) return access;

    const { searchParams } = new URL(request.url);
    const period = (searchParams.get('period') ?? 'mtd') as ChatterPeriod;
    if (!CHATTER_PERIODS.includes(period)) {
      return NextResponse.json({ error: 'Unknown period' }, { status: 400 });
    }
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (period === 'custom') {
      if (!isDayKey(from) || !isDayKey(to) || from > to) {
        return NextResponse.json({ error: 'A custom range needs from ≤ to (YYYY-MM-DD).' }, { status: 400 });
      }
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
      if (days > MAX_CUSTOM_DAYS) {
        return NextResponse.json({ error: `A custom range can span at most ${MAX_CUSTOM_DAYS} days.` }, { status: 400 });
      }
    }

    const data = await getChatterAnalytics({ period, from, to, viewerUid: token.uid, isAdmin: access.isAdmin });
    return NextResponse.json(data, { headers: ANALYTICS_CACHE_HEADERS });
  } catch (err) {
    return handleApiError(err, 'analytics/chatters GET');
  }
});
