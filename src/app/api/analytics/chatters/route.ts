/**
 * GET /api/analytics/chatters?period=7d|mtd|prev-month|month-2|3m|6m|12m|custom[&from&to] (default 7d)
 *
 * Chatter Analytics (`ca-chatter-analytics`). Everyone gets their own figures,
 * their daily trend, the team's sales and the **named sales board** — sales
 * only (`SalesBoardRow`): no colleague's activity, reply times or integrity
 * data ever reaches an agent. `ca-admin` also gets unlinked BuddyX chatters on
 * the board and the integrity flags.
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
