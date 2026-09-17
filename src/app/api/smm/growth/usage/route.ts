import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { checkGrowthAccess } from '@/lib/services/growthTrackingService';
import {
  getApifyUsage,
  isValidUsageMonth,
  usageMonthKey,
} from '@/lib/services/apifyUsageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * A sync walks the month's run list and can resolve a few actor names, so it
 * wants more than a default lambda's ten seconds. Nothing here starts an actor
 * run — every call is free account metadata (see `apifyUsageService`).
 */
export const maxDuration = 30;

/**
 * GET /api/smm/growth/usage?month=YYYY-MM[&refresh=1] — what Apify billed.
 *
 * Gated on the same page permission as the rest of Growth Tracking rather than
 * the admin claim: this is the cost of a feature its own operators turn on and
 * off, and hiding the bill from the people generating it is how the estimate
 * came to be the only figure anyone saw.
 *
 * `refresh=1` forces a live read. It is not rate-limited because it cannot
 * spend anything — the expensive paths are actor runs, and this route has none.
 * The TTL exists to keep the dialog fast, not to protect a budget.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const requested = request.nextUrl.searchParams.get('month') ?? usageMonthKey();
    if (!isValidUsageMonth(requested)) {
      return NextResponse.json(
        { error: 'Ask for a month as YYYY-MM, no later than the current one.' },
        { status: 400 },
      );
    }

    const force = request.nextUrl.searchParams.get('refresh') === '1';
    const usage = await getApifyUsage(requested, { force });
    return NextResponse.json({ usage });
  } catch (error) {
    return handleApiError(error, 'GET /api/smm/growth/usage');
  }
});
