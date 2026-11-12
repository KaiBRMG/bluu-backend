import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { getShadowReport } from '@/lib/services/onlymonsterShadowService';
import { currentMonthKey, isMonthKey } from '@/lib/salary/salaryDate';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/admin/onlymonster/shadow?month=YYYY-MM — the Phase 3 Shadow
 * reconciliation (`ca-admin`). What BuddyX pays beside what OnlyMonster would,
 * and what OnlyFans recorded. Admin-only: it names agents' pay.
 *
 * Uncached (`no-store`): it is read while the shadow is being judged, and a
 * stale answer would hide the very change being checked.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;
    const month = new URL(request.url).searchParams.get('month') ?? currentMonthKey();
    if (!isMonthKey(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    return NextResponse.json(await getShadowReport(month), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return handleApiError(error, 'GET /api/admin/onlymonster/shadow');
  }
});
