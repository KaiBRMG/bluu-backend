import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim, requireCaAdmin } from '@/lib/salary/salaryAuth';
import { getMapping, onlyFansBluuAccountIds, setManualAccountLink, setManualMemberLink } from '@/lib/services/onlymonsterMappingService';
import { getMigrationOverview, getOnlyMonsterConfig, getOnlyMonsterStatus, getRecentOnlyMonsterRuns } from '@/lib/services/onlymonsterSyncService';
import { displayNamesFor } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET   /api/admin/onlymonster/mapping: every OnlyMonster account and member,
 *       the Bluu identity each resolves to, sync freshness and the last runs (`ca-admin`).
 * PATCH /api/admin/onlymonster/mapping `{ kind: 'account' | 'member', id, target }`:
 *       link manually, or `target: null` to clear (admin claim).
 *
 * Linking is the admin claim, not the page permission (rule 3): from Phase 3 on
 * it decides which creator an OnlyFans account's sales belong to.
 *
 * Uncached (`no-store`): the screen it serves edits it.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    // The reconciliation carries each creator's monthly revenue (subscriptions included),
    // which OnlyFans Analytics keeps behind its own permission: admin claim only (rule 10).
    const isAdmin = token.admin === true;
    const [{ accounts, members }, status, runs, linkTargets, config, migration] = await Promise.all([
      getMapping(),
      getOnlyMonsterStatus(),
      getRecentOnlyMonsterRuns(5),
      onlyFansBluuAccountIds(),
      getOnlyMonsterConfig(),
      isAdmin ? getMigrationOverview() : Promise.resolve(null),
    ]);
    const names = await displayNamesFor(members.map(m => m.uid));

    return NextResponse.json(
      {
        status,
        runs,
        // The only valid manual-link targets: Bluu accounts whose platform is OnlyFans.
        linkTargets,
        config,
        migration,
        accounts: accounts
          .map(a => ({
            accountId: a.accountId,
            platform: a.platform,
            username: a.username,
            customLabel: a.customLabel,
            creatorId: a.creatorId,
            creatorName: a.creatorName,
            match: a.match,
            listed: a.listed !== false,
          }))
          .sort((x, y) => (x.username ?? '').localeCompare(y.username ?? '')),
        members: members
          .map(m => ({
            memberId: m.memberId,
            name: m.customName || m.name,
            email: m.email,
            uid: m.uid,
            displayName: m.uid ? names.get(m.uid) ?? null : null,
            match: m.match,
            listed: m.listed !== false,
          }))
          .sort((x, y) => (x.name ?? '').localeCompare(y.name ?? '')),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return handleApiError(error, 'GET /api/admin/onlymonster/mapping');
  }
});

export const PATCH = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = requireAdminClaim(token);
    if (denied) return denied;

    const parsed = await readJsonBody(request, 1024);
    if (!parsed.ok) return parsed.response;
    const { kind, id, target } = parsed.body as { kind?: unknown; id?: unknown; target?: unknown };

    if ((kind !== 'account' && kind !== 'member') || typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 });
    }
    if (target !== null && (typeof target !== 'string' || !target)) {
      return NextResponse.json({ error: 'target must be an id or null' }, { status: 400 });
    }

    try {
      if (kind === 'account') await setManualAccountLink(id, target, token.uid);
      else await setManualMemberLink(id, target, token.uid);
    } catch (err) {
      return handleApiError(err, 'PATCH /api/admin/onlymonster/mapping', 400);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'PATCH /api/admin/onlymonster/mapping');
  }
});
