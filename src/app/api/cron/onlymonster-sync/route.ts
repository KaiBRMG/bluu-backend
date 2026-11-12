import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { runOnlyMonsterSync } from '@/lib/services/onlymonsterSyncService';

/**
 * GET /api/cron/onlymonster-sync — the scheduled OnlyMonster pull.
 *
 * Vercel Cron, `1 5,13,21 * * *` (07:01 / 15:01 / 23:01 SAST, D10). It lives
 * here rather than in `functions/` because it sends a notification
 * (`onlymonsterSyncFailing`) and needs `src/lib` services (hub rule).
 *
 * Phase 1 runs the `directory` stage only (documentation/onlymonster.md). A run
 * that finds another holding the lease skips. A run with no
 * `ONLYMONSTER_API_KEY` configured skips without alerting.
 */
export const maxDuration = 300;

export async function GET() {
  const authorization = (await headers()).get('authorization');
  // Fail closed when CRON_SECRET is unset.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const outcome = await runOnlyMonsterSync({ trigger: 'cron' });
    if (outcome.status === 'skipped') {
      console.log(`[onlymonster-sync] skipped: ${outcome.reason}`);
      return NextResponse.json({ skipped: true, reason: outcome.reason });
    }
    const { result } = outcome;
    console.log(
      `[onlymonster-sync] ran ${result.ran.join(',')} in ${result.durationMs}ms, ${result.requestCount} requests` +
        (result.failed.length ? `; FAILED ${result.failed.join(',')}` : '') +
        (result.warnings.length ? `; ${result.warnings.length} warning(s)` : ''),
    );
    return NextResponse.json({
      runId: result.runId,
      ran: result.ran,
      failed: result.failed,
      requestCount: result.requestCount,
      partial: result.partial,
    });
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/onlymonster-sync');
  }
}
