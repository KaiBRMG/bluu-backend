import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { mappedCreatorIds } from '@/lib/services/onlymonsterMappingService';

/**
 * GET /api/onlymonster/creators — the creators (and sub-accounts) an OnlyFans
 * account in OnlyMonster maps to: the dispute dialog's creator picker.
 *
 * Creator ids are not sensitive; any signed-in employee. Browser-cached 5 min
 * (`private` + `Vary: Authorization`, rule 9i) — the map changes a few times a
 * year. One field-masked query, cached 60 s per instance.
 */
export const GET = withAuth(async () => {
  try {
    return NextResponse.json(
      { creatorIds: await mappedCreatorIds() },
      { headers: { 'Cache-Control': 'private, max-age=300', Vary: 'Authorization' } },
    );
  } catch (error) {
    return handleApiError(error, 'GET /api/onlymonster/creators');
  }
});
