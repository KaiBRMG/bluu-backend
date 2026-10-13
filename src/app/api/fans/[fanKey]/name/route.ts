/**
 * PUT /api/fans/[fanKey]/name { name: string | null } — set a fan's name by
 * hand, or `null` to revert to the automatic one (customs → BuddyX/Infloww).
 *
 * Anyone with Fan Analytics may rename a fan they can see (the same scope as
 * the report, re-checked here). The name is written through to the fan's
 * sales and analytics rollups, so it changes everywhere at once.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess } from '@/lib/buddyx/analyticsAuth';
import { getUserById } from '@/lib/services/userService';
import { canViewFan } from '@/lib/services/fanBaseService';
import { setManualFanName } from '@/lib/services/fanRegistryService';
import { cleanFanName } from '@/lib/fans/fanIdentity';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const PUT = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ fanKey: string }>,
) => {
  try {
    const access = await analyticsAccess(token, 'ca-fan-analytics');
    if (access instanceof NextResponse) return access;

    const fanKey = decodeURIComponent((await params).fanKey);
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    if (!body || !(body.name === null || typeof body.name === 'string')) {
      return NextResponse.json({ error: 'Send { name: string | null }' }, { status: 400 });
    }
    if (typeof body.name === 'string' && !cleanFanName(body.name)) {
      return NextResponse.json({ error: 'A name cannot be blank.' }, { status: 400 });
    }
    if (!(await canViewFan({ viewerUid: token.uid, isAdmin: access.isAdmin, fanKey }))) {
      return NextResponse.json({ error: 'Fan not found' }, { status: 404 });
    }

    const caller = await getUserById(token.uid);
    await setManualFanName(fanKey, body.name, { uid: token.uid, name: caller?.displayName ?? token.uid });
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'fans/[fanKey]/name PUT');
  }
});
