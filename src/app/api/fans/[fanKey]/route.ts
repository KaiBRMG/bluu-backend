/**
 * GET /api/fans/[fanKey] — one fan's report: name and where it came from,
 * spend across creators, purchases, subscriptions, acquisition, and their
 * customs (types, outstanding, abandoned).
 *
 * **404s a fan with nothing in the viewer's scope**, exactly as for a fan that
 * does not exist. A handle entry that has been linked answers
 * `{ movedTo }` so the page can follow it to the id.
 *
 * `no-store`: the page re-reads after a rename and must see it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess } from '@/lib/buddyx/analyticsAuth';
import { getFanReport } from '@/lib/services/fanBaseService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ fanKey: string }>,
) => {
  try {
    const access = await analyticsAccess(token, 'ca-fan-analytics');
    if (access instanceof NextResponse) return access;

    const { fanKey } = await params;
    const report = await getFanReport({ viewerUid: token.uid, isAdmin: access.isAdmin, fanKey: decodeURIComponent(fanKey) });
    if (!report) return NextResponse.json({ error: 'Fan not found' }, { status: 404 });
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleApiError(err, 'fans/[fanKey] GET');
  }
});
