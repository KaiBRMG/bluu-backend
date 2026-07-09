import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkSmmAccess, findLinkUsage, resolveUserInfo } from '@/lib/services/smmService';
import { normalizePostLink } from '@/lib/smm/linkUtils';
import type { DecodedIdToken } from 'firebase-admin/auth';

const ELIGIBLE_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/smm/bonus/eligibility?link=URL
 * Wizard step 2. A link is eligible if it has never been used, or its most
 * recent prior use was more than 14 days ago. This is advisory only — the
 * submit route re-checks server-side.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'dashboard');
    if (denied) return denied;

    const link = request.nextUrl.searchParams.get('link') ?? '';
    const normalized = normalizePostLink(link);
    if (!normalized) {
      return NextResponse.json({ error: 'A link is required' }, { status: 400 });
    }

    const usage = await findLinkUsage(normalized);
    if (!usage) {
      return NextResponse.json({ found: false, eligible: true });
    }

    const names = await resolveUserInfo([usage.userId]);
    const daysDiff = usage.refDate
      ? Math.floor((Date.now() - new Date(usage.refDate).getTime()) / DAY_MS)
      : Infinity;

    return NextResponse.json({
      found: true,
      source: usage.source,
      eligible: daysDiff > ELIGIBLE_AFTER_DAYS,
      daysDiff: Number.isFinite(daysDiff) ? daysDiff : null,
      detail: {
        link: usage.detailLink,
        userName: names.get(usage.userId)?.displayName ?? '',
        date: usage.refDate,
      },
    });
  } catch (error) {
    console.error('[GET /api/smm/bonus/eligibility]', error);
    return NextResponse.json({ error: 'Failed to check eligibility' }, { status: 500 });
  }
});
