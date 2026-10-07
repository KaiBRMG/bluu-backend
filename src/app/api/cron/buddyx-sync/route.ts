import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { runBuddyxSync } from '@/lib/services/buddyxSyncService';
import type { BuddyxScope } from '@/lib/buddyx/constants';

/**
 * GET /api/cron/buddyx-sync — the scheduled BuddyX pull.
 *
 * Vercel Cron, `1 5,13,21 * * *` (07:01 / 15:01 / 23:01 SAST). Every run pulls
 * `directory` → `sales` → `chatters` → `creators`; the 21:01 UTC run also pulls
 * `fans`, which is the slow one and only needs to be daily.
 *
 * It lives here rather than in `functions/` because it sends a notification
 * (`buddyxSyncFailing`) and needs `src/lib` services (hub rule).
 *
 * A run that finds another sync holding the lease (a manual refresh mid-flight)
 * skips rather than queueing: the next tick is eight hours away at most, and
 * two runs fighting over one rate limit help nobody.
 *
 * Whether `sales` *writes* is decided by `buddyx-meta/config.salesWriteEnabled`,
 * not here — until an admin switches it on, the cron's sales pass is a dry run.
 */
export const maxDuration = 300;

export async function GET() {
  const authorization = (await headers()).get('authorization');

  // Fail closed when CRON_SECRET is unset: this writes sales that pay people.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const scopes: BuddyxScope[] = ['directory', 'sales', 'chatters', 'creators'];
    if (new Date().getUTCHours() === 21) scopes.push('fans');

    const outcome = await runBuddyxSync({ scopes, trigger: 'cron' });
    if (!outcome.ok) {
      console.log(`[buddyx-sync] skipped — a ${outcome.running} sync is already running`);
      return NextResponse.json({ skipped: true, running: outcome.running });
    }

    const { result } = outcome;
    console.log(
      `[buddyx-sync] ran ${result.ran.join(',')} in ${result.durationMs}ms, ${result.requestCount} requests` +
        (result.failed.length ? `; FAILED ${result.failed.join(',')}` : ''),
    );
    // The full counts are on the run log; the response stays small.
    return NextResponse.json({
      runId: result.runId,
      ran: result.ran,
      failed: result.failed,
      requestCount: result.requestCount,
      partial: result.partial,
    });
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/buddyx-sync');
  }
}
