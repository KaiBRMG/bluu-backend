/**
 * GET /api/analytics/fans/[creatorId]/[fanId] — the fan drawer.
 *
 * Purchases (both sources, the cutover marked by `source`), subscription
 * events, acquisition link, and who earned what from the fan — names for
 * `ca-admin`, "You" / "Team" for an agent. **404s a fan whose creator is
 * outside the viewer's scope**, exactly as for a fan that does not exist, so
 * the drawer cannot be used to read a creator the agent is not rostered on.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess, ANALYTICS_CACHE_HEADERS } from '@/lib/buddyx/analyticsAuth';
import { getFanDetail } from '@/lib/services/buddyxAnalyticsService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ creatorId: string; fanId: string }>,
) => {
  try {
    const access = await analyticsAccess(token, 'ca-fan-analytics');
    if (access instanceof NextResponse) return access;

    const { creatorId, fanId } = await params;
    const detail = await getFanDetail({ viewerUid: token.uid, isAdmin: access.isAdmin, creatorId, fanId });
    if (!detail) return NextResponse.json({ error: 'Fan not found' }, { status: 404 });
    return NextResponse.json(detail, { headers: ANALYTICS_CACHE_HEADERS });
  } catch (err) {
    return handleApiError(err, 'analytics/fans/[creatorId]/[fanId] GET');
  }
});
