import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { GROWTH_ACCOUNTS, checkGrowthAccess } from '@/lib/services/growthTrackingService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * PATCH /api/smm/growth/accounts/[id] — stop or resume tracking, or rename.
 *
 * "Remove" in the UI is `isActive: false`, not a delete: the account stops being
 * scraped (and stops costing money) while its history is kept and the account
 * can be resumed. Archive ≠ delete — the same principle as rule 6, applied here
 * because months of daily readings cannot be recovered once dropped.
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json() as { isActive?: boolean };

    // `isActive` is the ONLY mutable field. An account is named by its handle
    // and nothing else, and the handle — with the platform and profile URL — is
    // the identity the document id is built from, so changing one would orphan
    // the history rather than move it.
    if (typeof body.isActive !== 'boolean') {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const ref = adminDb.collection(GROWTH_ACCOUNTS).doc(id);
    if (!(await ref.get()).exists) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    await ref.update({ isActive: body.isActive });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'PATCH /api/smm/growth/accounts/[id]');
  }
});

/**
 * DELETE /api/smm/growth/accounts/[id] — permanent, including all history.
 *
 * Reachable only from the stopped list, behind a confirm that names what is
 * being destroyed. `recursiveDelete` takes the `series` subcollection with it —
 * rules do not cascade and neither does a document delete, so without this the
 * readings would linger unreachable.
 */
export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const { id } = await params;
    await adminDb.recursiveDelete(adminDb.collection(GROWTH_ACCOUNTS).doc(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'DELETE /api/smm/growth/accounts/[id]');
  }
});
