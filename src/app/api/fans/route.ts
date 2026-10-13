/**
 * GET /api/fans?q&filter&sort&creatorId&offset — the fan directory.
 *
 * Fan Analytics (`ca-fan-analytics`): an agent sees fans of the creators they
 * are rostered on this month; `ca-admin` sees all (D9). Spend and customs are
 * folded across creators, one row per fan. The scope is the server's, never
 * the query's.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess, ANALYTICS_CACHE_HEADERS } from '@/lib/buddyx/analyticsAuth';
import {
  FAN_DIRECTORY_FILTERS,
  FAN_DIRECTORY_SORTS,
  type FanDirectoryFilter,
  type FanDirectorySort,
} from '@/lib/buddyx/analyticsTypes';
import { getFanDirectory } from '@/lib/services/fanBaseService';
import type { DecodedIdToken } from 'firebase-admin/auth';

const PAGE_SIZE = 50;

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const access = await analyticsAccess(token, 'ca-fan-analytics');
    if (access instanceof NextResponse) return access;

    const { searchParams } = new URL(request.url);
    const filter = (searchParams.get('filter') ?? 'all') as FanDirectoryFilter;
    const sort = (searchParams.get('sort') ?? 'spend') as FanDirectorySort;
    if (!FAN_DIRECTORY_FILTERS.includes(filter) || !FAN_DIRECTORY_SORTS.includes(sort)) {
      return NextResponse.json({ error: 'Unknown filter or sort' }, { status: 400 });
    }
    const offset = Math.max(0, Math.min(100_000, Number(searchParams.get('offset')) || 0));

    const data = await getFanDirectory({
      viewerUid: token.uid,
      isAdmin: access.isAdmin,
      creatorId: searchParams.get('creatorId') || null,
      q: (searchParams.get('q') ?? '').slice(0, 200),
      filter,
      sort,
      offset,
      limit: PAGE_SIZE,
    });
    return NextResponse.json(data, { headers: ANALYTICS_CACHE_HEADERS });
  } catch (err) {
    return handleApiError(err, 'fans GET');
  }
});
