import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { openArchivedAccountIds } from '@/lib/services/creatorArchiveService';

/**
 * GET /api/ca-sales/archived-creators — archived accounts whose sales can still
 * be disputed, so the sale pickers (New dispute, CA Admin → Sales) keep them
 * until their archive month is finalised. See `openArchivedAccountIds`.
 *
 * Creator ids are not sensitive; any signed-in employee, as
 * `/api/onlymonster/creators`. Browser-cached 5 min (`private` + `Vary:
 * Authorization`, rule 9i) and 60 s per instance — a finalisation takes at most
 * that long to drop an account from the list, which is harmless: a sale in a
 * finalised month is refused at claim time anyway.
 */
export const GET = withAuth(async () => {
  try {
    return NextResponse.json(
      { creatorIds: await openArchivedAccountIds() },
      { headers: { 'Cache-Control': 'private, max-age=300', Vary: 'Authorization' } },
    );
  } catch (error) {
    return handleApiError(error, 'GET /api/ca-sales/archived-creators');
  }
});
