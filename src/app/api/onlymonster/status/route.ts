import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getOnlyMonsterStatus } from '@/lib/services/onlymonsterSyncService';

/**
 * GET /api/onlymonster/status — when the OnlyMonster sync last wrote, and when
 * it runs next: the "Updated 13:01 · next 21:01" label on every analytics and
 * sales page header (`SyncFreshness`). One document read.
 *
 * Any signed-in employee: it says *when* data was synced, never what it is.
 * Projected to the label's four fields (rule 9i) — the per-stage errors stay
 * on the admin mapping route. Browser-cached 60 s (`private` + `Vary:
 * Authorization`): the data changes three times a day. After a refresh (D26)
 * `SyncFreshness` re-reads it with `cache: 'no-store'`.
 */
export const GET = withAuth(async () => {
  try {
    const { configured, updatedAt, nextRunAt, lastRunOk } = await getOnlyMonsterStatus();
    return NextResponse.json(
      { configured, updatedAt, nextRunAt, lastRunOk },
      { headers: { 'Cache-Control': 'private, max-age=60', Vary: 'Authorization' } },
    );
  } catch (error) {
    return handleApiError(error, 'GET /api/onlymonster/status');
  }
});
