import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim } from '@/lib/salary/salaryAuth';
import { setSalesWriteEnabled } from '@/lib/services/buddyxSyncService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * PATCH /api/admin/buddyx/config `{ salesWriteEnabled }` — switch the BuddyX
 * sales sync from dry run to writing `ca-sales` (admin claim).
 *
 * The switch is what sequencing step 3 rests on: nothing pays from BuddyX until
 * an admin has checked a dry run against the BuddyX dashboard and turned this
 * on. It is a Firestore document, not a constant, so it reaches every server
 * instance at once and can be turned back off without a deploy (rule 9c).
 */
export const PATCH = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = requireAdminClaim(token);
    if (denied) return denied;

    const parsed = await readJsonBody(request, 256);
    if (!parsed.ok) return parsed.response;
    const { salesWriteEnabled } = parsed.body as { salesWriteEnabled?: unknown };
    if (typeof salesWriteEnabled !== 'boolean') {
      return NextResponse.json({ error: 'salesWriteEnabled must be a boolean' }, { status: 400 });
    }

    await setSalesWriteEnabled(salesWriteEnabled, token.uid);
    return NextResponse.json({ success: true, salesWriteEnabled });
  } catch (error) {
    return handleApiError(error, 'PATCH /api/admin/buddyx/config');
  }
});
