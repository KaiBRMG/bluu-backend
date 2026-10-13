/**
 * POST /api/fans/[fanKey]/link { fanId } — attach a fan known only by an
 * OnlyFans handle (`h_<handle>`) to their numeric OnlyFans id, so their
 * customs join their sales. Accepts the id, `u<id>` or a `/u<id>` link.
 *
 * `ca-admin` only: it re-keys every custom the fan has, and a wrong link would
 * merge two people. The handle stays an alias of the id, so a later custom
 * pasted with the handle link lands on the right fan.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess } from '@/lib/buddyx/analyticsAuth';
import { linkHandleFan } from '@/lib/services/fanRegistryService';
import { isHandleKey, isValidFanKey, parseProfileLink } from '@/lib/fans/fanIdentity';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ fanKey: string }>,
) => {
  try {
    const access = await analyticsAccess(token, 'ca-fan-analytics');
    if (access instanceof NextResponse) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Only a CA admin can link a fan.' }, { status: 403 });

    const fanKey = decodeURIComponent((await params).fanKey);
    if (!isValidFanKey(fanKey) || !isHandleKey(fanKey)) {
      return NextResponse.json({ error: 'Only a fan known by handle can be linked.' }, { status: 400 });
    }
    const body = (await request.json().catch(() => null)) as { fanId?: unknown } | null;
    const fanId = typeof body?.fanId === 'string' ? parseProfileLink(body.fanId)?.fanId ?? null : null;
    if (!fanId) {
      return NextResponse.json({ error: 'Enter the OnlyFans id — the number, or a link like onlyfans.com/u123456.' }, { status: 400 });
    }

    await linkHandleFan(fanKey, fanId, token.uid);
    return NextResponse.json({ success: true, fanKey: fanId });
  } catch (err) {
    if (err instanceof Error && /already linked|not found|Only a fan/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return handleApiError(err, 'fans/[fanKey]/link POST');
  }
});
