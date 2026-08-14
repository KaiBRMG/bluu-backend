import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { listVaultListsCached, requireOnlyFansAccess } from '@/lib/services/onlyfansService';
import { OnlyFansApiError, resolveAccountId } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/onlyfans/vault/lists — the creator's vault categories.
 *
 * Billed, and the answer changes about never, so it is memoised for half an hour
 * per server instance. The composer's vault dialog opens many times a shift; the
 * creator makes a folder about never.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;

  try {
    const accountId = await resolveAccountId();
    return NextResponse.json({ lists: await listVaultListsCached(accountId) });
  } catch (error) {
    if (error instanceof OnlyFansApiError) {
      return handleApiError(
        error,
        'GET /api/onlyfans/vault/lists',
        error.status >= 500 ? 502 : error.status,
      );
    }
    return handleApiError(error, 'GET /api/onlyfans/vault/lists');
  }
});
