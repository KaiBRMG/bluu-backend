import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim } from '@/lib/salary/salaryAuth';
import { getBalances } from '@/lib/services/onlymonsterLedgerService';
import { isStatementsConfigured } from '@/lib/onlymonster/statementsClient';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/admin/onlymonster/balances — creators' OnlyFans payout balances and
 * recent payout requests, as the daily sync last read them (migration plan §12).
 * **Admin claim only** — it is creators' money. Read-only: nothing in this
 * codebase can create a payout. Firestore only; per-viewer, `no-store`.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = requireAdminClaim(token);
    if (denied) return denied;
    return NextResponse.json(
      { configured: isStatementsConfigured(), balances: await getBalances() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return handleApiError(error, 'GET /api/admin/onlymonster/balances');
  }
});
