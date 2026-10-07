import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { getRecentSyncRuns } from '@/lib/services/buddyxSyncService';
import { displayNamesFor } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/admin/buddyx/runs — the last 20 sync runs, for CA Admin → Sales →
 * Sync history (`ca-admin`). One ordered query; a manual run's trigger uid is
 * resolved to a name. Uncached: it is opened to see what just happened.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const runs = await getRecentSyncRuns(20);
    const names = await displayNamesFor(runs.map(r => (r.trigger === 'cron' ? null : r.trigger)));
    return NextResponse.json(
      { runs: runs.map(r => ({ ...r, triggerName: r.trigger === 'cron' ? 'Scheduled' : names.get(r.trigger) ?? 'Someone' })) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return handleApiError(error, 'GET /api/admin/buddyx/runs');
  }
});
