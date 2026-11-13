import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { CA_ADMIN_PAGE_ID } from '@/lib/salary/salaryAuth';
import { refreshOnlyMonster } from '@/lib/services/onlymonsterSyncService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/onlymonster/refresh — run the OnlyMonster sync now, from the
 * refresh button on CA Admin → Sales and the agent's Sales Report.
 *
 * The same run the cron makes (`refreshOnlyMonster`): new sales land in
 * `ca-sales`, and every salary follows because salary is derived on read. It
 * says nothing about anyone's money — it only asks for fresher data — so it is
 * gated on the pages that already show it (`ca-dashboard` or `ca-admin`),
 * not on the admin claim.
 *
 * Answers:
 * - `200 { ran: true, partial, failed }` — the run finished (or ran out of time;
 *   the continuation finishes it within ten minutes).
 * - `200 { fresh: true, syncedAt }` — synced under two minutes ago; no API call.
 * - `409 { running: true }` — another run (the cron or someone's refresh) holds
 *   the lease; its data arrives when it finishes.
 * - `503` — OnlyMonster is not configured.
 *
 * Never cached (an action). `maxDuration` matches the cron's: a run is ~1 min.
 */
export const maxDuration = 300;

export const POST = withAuth(async (_request: Request, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, ['ca-dashboard', CA_ADMIN_PAGE_ID]);
    if (denied) return denied;

    const outcome = await refreshOnlyMonster(token.uid);
    switch (outcome.status) {
      case 'fresh':
        return NextResponse.json({ fresh: true, syncedAt: outcome.syncedAt });
      case 'running':
        return NextResponse.json({ running: true, error: 'A sync is already running. The figures update when it finishes.' }, { status: 409 });
      case 'not-configured':
        return NextResponse.json({ error: 'OnlyMonster is not connected.' }, { status: 503 });
      case 'ran': {
        const { result } = outcome;
        console.log(
          `[onlymonster-refresh] ${token.uid} ran ${result.ran.join(',')} in ${result.durationMs}ms, ${result.requestCount} requests` +
            (result.failed.length ? `; FAILED ${result.failed.join(',')}` : ''),
        );
        return NextResponse.json({ ran: true, partial: result.partial, failed: result.failed });
      }
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/onlymonster/refresh');
  }
});
