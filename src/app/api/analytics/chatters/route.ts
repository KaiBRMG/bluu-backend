/**
 * GET /api/analytics/chatters?period=7d|mtd|prev-month|30d|custom[&from&to] (default 7d)
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
import { analyticsAccess, ANALYTICS_CACHE_HEADERS, parseChatterPeriod } from '@/lib/buddyx/analyticsAuth';
import { getChatterAnalytics } from '@/lib/services/buddyxAnalyticsService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const access = await analyticsAccess(token, 'ca-chatter-analytics');
    if (access instanceof NextResponse) return access;

    const parsed = parseChatterPeriod(new URL(request.url).searchParams, '7d');
    if (parsed instanceof NextResponse) return parsed;

    const data = await getChatterAnalytics({ ...parsed, viewerUid: token.uid, isAdmin: access.isAdmin });
    return NextResponse.json(data, { headers: ANALYTICS_CACHE_HEADERS });
  } catch (err) {
    return handleApiError(err, 'analytics/chatters GET');
  }
});
