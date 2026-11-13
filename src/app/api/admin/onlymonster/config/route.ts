import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim } from '@/lib/salary/salaryAuth';
import { setOnlyMonsterConfig } from '@/lib/services/onlymonsterSyncService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * PATCH /api/admin/onlymonster/config `{ salesWriteEnabled: boolean }`
 *
 * The migration's pay switch (rule 9c: server-read, never compiled in), admin
 * claim only (rule 3). Whether the OnlyMonster pay derivation writes `ca-sales`
 * (off → `ca-sales-shadow` only). It changes whose pay a sale lands in, so it
 * refuses to turn on while `ONLYMONSTER_CUTOVER_AT` is unset. (The analytics
 * source switch was removed with BuddyX: analytics always read OnlyMonster.)
 */
export const PATCH = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = requireAdminClaim(token);
    if (denied) return denied;
    const parsed = await readJsonBody(request, 512);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { salesWriteEnabled?: unknown };

    if (typeof body.salesWriteEnabled !== 'boolean') return NextResponse.json({ error: 'salesWriteEnabled must be a boolean' }, { status: 400 });
    const { ONLYMONSTER_CUTOVER_AT } = await import('@/lib/salary/salaryConstants');
    if (body.salesWriteEnabled && !Number.isFinite(ONLYMONSTER_CUTOVER_AT)) {
      return NextResponse.json(
        { error: 'ONLYMONSTER_CUTOVER_AT is not set. Set the cutover instant and deploy before switching pay writes on (Phase 4).' },
        { status: 409 },
      );
    }

    await setOnlyMonsterConfig({ salesWriteEnabled: body.salesWriteEnabled }, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'PATCH /api/admin/onlymonster/config');
  }
});
