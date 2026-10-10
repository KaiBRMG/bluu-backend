/**
 * GET /api/analytics/chatters/[uid]?period=…[&from&to] — one agent's report.
 *
 * **`ca-admin` only** (or the admin claim). Carries the integrity layer —
 * coverage, input-quality and unchanged-screen counts, and the flags — which
 * an agent never sees, not even their own (documentation/time-tracking.md §4b).
 * Display only: nothing here changes worked time or pay.
 *
 * Firestore only; the API is never called on a page read. Per-viewer response,
 * so the browser cache is the only cache (rule 9i).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess, ANALYTICS_CACHE_HEADERS, parseChatterPeriod } from '@/lib/buddyx/analyticsAuth';
import { getChatterReport } from '@/lib/services/buddyxAnalyticsService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth<{ uid: string }>(async (request: NextRequest, token: DecodedIdToken, params) => {
  try {
    const access = await analyticsAccess(token, 'ca-chatter-analytics');
    if (access instanceof NextResponse) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Reports are for CA admins' }, { status: 403 });

    const { uid } = await params;
    if (!uid || uid.length > 128) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 });

    const parsed = parseChatterPeriod(new URL(request.url).searchParams, '7d');
    if (parsed instanceof NextResponse) return parsed;

    const report = await getChatterReport({ uid, ...parsed });
    return NextResponse.json(report, { headers: ANALYTICS_CACHE_HEADERS });
  } catch (err) {
    return handleApiError(err, 'analytics/chatters/[uid] GET');
  }
});
