import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { runOnlyMonsterSync } from '@/lib/services/onlymonsterSyncService';

/**
 * GET /api/cron/onlymonster-continue — the continuation tick (D21), every ten minutes.
 *
 * It does **not** add freshness: data still updates 3× a day (D10). It only
 * resumes stages a scheduled run left pending when it ran out of its 240 s
 * budget, and advances the account-ledger backfill (D9) in time-boxed chunks.
 * When there is nothing to do it costs one Firestore read (two docs in one
 * `getAll`) and returns `idle`. The scheduled run and this share one lease, so
 * they never overlap.
 */
export const maxDuration = 300;

export async function GET() {
  const authorization = (await headers()).get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const outcome = await runOnlyMonsterSync({ trigger: 'continue' });
    if (outcome.status === 'skipped') return NextResponse.json({ skipped: true, reason: outcome.reason });
    const { result } = outcome;
    console.log(
      `[onlymonster-continue] ran ${result.ran.join(',') || 'backfill'} in ${result.durationMs}ms, ${result.requestCount} requests` +
        (result.counts['backfill.total'] ? `; backfill ${result.counts['backfill.next']}/${result.counts['backfill.total']}` : ''),
    );
    return NextResponse.json({ runId: result.runId, ran: result.ran, partial: result.partial, requestCount: result.requestCount });
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/onlymonster-continue');
  }
}
