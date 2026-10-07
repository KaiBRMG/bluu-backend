/**
 * GET /api/analytics/fans?period=month|prev-month|3m|lifetime[&creatorId]
 *
 * Fan Analytics (`ca-fan-analytics`). An agent sees fans of the creators they
 * are **rostered on this month**; `ca-admin` sees every creator, plus the
 * acquisition-link table (D9). A `creatorId` outside the viewer's scope simply
 * yields nothing — the scope is the server's, never the query's.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess, ANALYTICS_CACHE_HEADERS } from '@/lib/buddyx/analyticsAuth';
import { FAN_PERIODS, type FanPeriod } from '@/lib/buddyx/analyticsTypes';
import { getFanAnalytics } from '@/lib/services/buddyxAnalyticsService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const access = await analyticsAccess(token, 'ca-fan-analytics');
    if (access instanceof NextResponse) return access;

    const { searchParams } = new URL(request.url);
    const period = (searchParams.get('period') ?? 'month') as FanPeriod;
    if (!FAN_PERIODS.includes(period)) return NextResponse.json({ error: 'Unknown period' }, { status: 400 });

    const data = await getFanAnalytics({
      viewerUid: token.uid,
      isAdmin: access.isAdmin,
      creatorId: searchParams.get('creatorId') || null,
      period,
    });
    return NextResponse.json(data, { headers: ANALYTICS_CACHE_HEADERS });
  } catch (err) {
    return handleApiError(err, 'analytics/fans GET');
  }
});
