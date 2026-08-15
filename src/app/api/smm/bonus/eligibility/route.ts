import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import {
  VIRAL_ELIGIBLE_AFTER_DAYS,
  checkSmmAccess, checkViralEligibility, findLinkUsageReport, resolveOriginalAccount,
} from '@/lib/services/smmService';
import { extractAccountHandle, normalizePostLink } from '@/lib/smm/linkUtils';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/bonus/eligibility?link=URL
 * The viral-copy check shown while scheduling a post ("Did you copy another
 * viral post?"), and the same lookup behind the link checker on Viral Accounts
 * — hence the 'viral-lookup' gate, which admits either page. Advisory only —
 * POST /api/smm/posts re-runs the same check server-side before storing the
 * copy declaration.
 *
 * It also resolves the account the original lives on, straight from the link,
 * so the SMM never types it: that account is both the copy's origin and the
 * post's "uploaded from" source (it decides the network bonus). `account: null`
 * means the handle is not in the database and the copy cannot be scheduled.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'viral-lookup');
    if (denied) return denied;

    const link = request.nextUrl.searchParams.get('link') ?? '';
    const normalized = normalizePostLink(link);
    if (!normalized) {
      return NextResponse.json({ error: 'A link is required' }, { status: 400 });
    }

    const [eligibility, account, report] = await Promise.all([
      checkViralEligibility(normalized),
      resolveOriginalAccount(link),
      findLinkUsageReport(normalized),
    ]);

    return NextResponse.json({
      ...eligibility,
      handle: extractAccountHandle(link),
      account,
      report,
      // The two-week rule's own number, so the client can say *when* a blocked
      // source comes back without re-declaring the rule. The server stays the
      // one place it is defined; nothing here costs an extra read.
      eligibleAfterDays: VIRAL_ELIGIBLE_AFTER_DAYS,
    });
  } catch (error) {
    console.error('[GET /api/smm/bonus/eligibility]', error);
    return NextResponse.json({ error: 'Failed to check eligibility' }, { status: 500 });
  }
});
