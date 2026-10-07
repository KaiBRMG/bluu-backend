import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getBuddyxStatus } from '@/lib/services/buddyxSyncService';

/**
 * GET /api/buddyx/status — per-scope freshness, and whether a sync is running.
 *
 * What every BuddyX-backed page header reads for "Synced 3 min ago", and what a
 * refresh polls while another sync holds the lease. Three document reads.
 *
 * Any signed-in employee: it says *when* data was synced, never what it is.
 * Browser-cached for 15s (`private` + `Vary: Authorization`, rule 9i) — short,
 * because the polling caller is waiting on it to change.
 */
export const GET = withAuth(async () => {
  try {
    const status = await getBuddyxStatus();
    return NextResponse.json(status, {
      headers: { 'Cache-Control': 'private, max-age=15', Vary: 'Authorization' },
    });
  } catch (error) {
    return handleApiError(error, 'GET /api/buddyx/status');
  }
});
