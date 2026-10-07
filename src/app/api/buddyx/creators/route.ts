import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { mappedCreatorIds } from '@/lib/services/buddyxMappingService';

/**
 * GET /api/buddyx/creators — the creators (and sub-accounts) a BuddyX model is
 * mapped to: the dispute dialog's creator picker.
 *
 * Its own route so `/api/buddyx/status`, which a refresh polls every 5s, never
 * scans a collection. Creator ids are not sensitive; any signed-in employee.
 * Browser-cached 5 min (`private` + `Vary: Authorization`, rule 9i) — the map
 * changes a few times a year.
 */
export const GET = withAuth(async () => {
  try {
    return NextResponse.json(
      { creatorIds: await mappedCreatorIds() },
      { headers: { 'Cache-Control': 'private, max-age=300', Vary: 'Authorization' } },
    );
  } catch (error) {
    return handleApiError(error, 'GET /api/buddyx/creators');
  }
});
