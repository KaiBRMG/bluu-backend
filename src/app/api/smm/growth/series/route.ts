import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  checkGrowthAccess,
  currentDayKey,
  listGrowthAccounts,
  readGrowthSeries,
  yearsBetween,
} from '@/lib/services/growthTrackingService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/growth/series[?from=YYYY-MM-DD]
 *
 * The chart payload. `from` is the inclusive start of the visible range and only
 * decides which *year* documents are read — the client slices to the exact day,
 * since it already holds the whole year it asked for and re-fetching on every
 * range flick would be a read per click for data already in memory.
 *
 * Omitting `from` means all time.
 *
 * One `getAll` over accounts × years: ~24 reads for the seed list, and flat as
 * history deepens because a year is a single document (rule 9).
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const from = request.nextUrl.searchParams.get('from');
    if (from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return NextResponse.json({ error: 'Invalid from date' }, { status: 400 });
    }

    const accounts = await listGrowthAccounts();
    // Stopped accounts keep their history and stay chartable — the point of
    // stopping rather than deleting is that the past stays visible.
    const series = await readGrowthSeries(
      accounts.map((a) => a.id),
      yearsBetween(from, currentDayKey()),
    );

    return NextResponse.json({ accounts, series });
  } catch (error) {
    return handleApiError(error, 'GET /api/smm/growth/series');
  }
});
