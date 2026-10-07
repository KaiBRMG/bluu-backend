/**
 * GET /api/analytics/creators?from=YYYY-MM-DD&to=YYYY-MM-DD[&creatorId]
 *
 * OnlyFans Analytics (`creators-of-analytics`, Creator Portal, internal only).
 * Earnings by source, subscribers, links, mass messages and chat performance —
 * one continuous series from October 2025, because the Infloww history was
 * imported keeping only the fields BuddyX continues (D3).
 *
 * Firestore only; the API is never called on a page read.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess, ANALYTICS_CACHE_HEADERS } from '@/lib/buddyx/analyticsAuth';
import { CREATOR_HISTORY_START_DAY, getCreatorAnalytics } from '@/lib/services/buddyxAnalyticsService';
import { currentDayKey, isDayKey } from '@/lib/salary/salaryDate';
import type { DecodedIdToken } from 'firebase-admin/auth';

const MAX_RANGE_DAYS = 400;

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const access = await analyticsAccess(token, 'creators-of-analytics');
    if (access instanceof NextResponse) return access;

    const { searchParams } = new URL(request.url);
    const today = currentDayKey();
    const from = searchParams.get('from') ?? `${today.slice(0, 7)}-01`;
    const to = searchParams.get('to') ?? today;
    if (!isDayKey(from) || !isDayKey(to) || from > to) {
      return NextResponse.json({ error: 'from ≤ to (YYYY-MM-DD) are required.' }, { status: 400 });
    }
    const clampedFrom = from < CREATOR_HISTORY_START_DAY ? CREATOR_HISTORY_START_DAY : from;
    const clampedTo = to > today ? today : to;
    if ((Date.parse(clampedTo) - Date.parse(clampedFrom)) / 86_400_000 + 1 > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `A range can span at most ${MAX_RANGE_DAYS} days.` }, { status: 400 });
    }

    const data = await getCreatorAnalytics({ from: clampedFrom, to: clampedTo, creatorId: searchParams.get('creatorId') || null });
    return NextResponse.json(data, { headers: ANALYTICS_CACHE_HEADERS });
  } catch (err) {
    return handleApiError(err, 'analytics/creators GET');
  }
});
