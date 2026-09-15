/**
 * PATCH  /api/admin/creators/[creatorId]/subaccounts/[subAccountId] — rename / archive
 * DELETE /api/admin/creators/[creatorId]/subaccounts/[subAccountId] — remove
 *
 * **Archive is the safe operation; delete is not.** A sub-account id lives in
 * `shifts.creatorIds` on every shift it was ever assigned to, and those shifts
 * are what the salary engine prices. Deleting the document leaves those ids
 * dangling: the shift still pays (the engine counts ids, and an id is still an
 * id) but the chip renders as a raw id nobody can identify.
 *
 * So delete refuses once the account has been assigned to anything, and points
 * at archive instead — which removes it from every picker while leaving history
 * readable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, checkPageAccess } from '@/lib/middleware/apiHelpers';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { subAccountStageName } from '@/lib/services/creatorAccountService';
import type { CreatorFullDocument, CreatorSubAccountDocument } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

const SUBACCOUNTS = 'creator-subaccounts';

/**
 * Is this account referenced by any shift? One indexed query, capped at one doc.
 *
 * Returns `null` when the question cannot be answered — which happens when the
 * `creatorIds` array index has not been deployed yet (the field was exempted
 * from indexing back when nothing queried it). **A failure here must not read as
 * "no", or a lookup outage would silently permit the one delete this guard
 * exists to prevent.** The caller refuses instead.
 */
async function isAssigned(subAccountId: string): Promise<boolean | null> {
  try {
    const snap = await adminDb
      .collection('shifts')
      .where('creatorIds', 'array-contains', subAccountId)
      .limit(1)
      .get();
    return !snap.empty;
  } catch (err) {
    console.error('[subaccounts DELETE] assignment check failed', err);
    return null;
  }
}

export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ creatorId: string; subAccountId: string }>,
) => {
  try {
    const denied = await checkPageAccess(token.uid, 'admin-creator-management');
    if (denied) return denied;

    const { creatorId, subAccountId } = await params;
    const body = (await request.json()) as { label?: string; OFID?: string; isArchived?: boolean };

    const ref = adminDb.collection(SUBACCOUNTS).doc(subAccountId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });

    const current = snap.data() as CreatorSubAccountDocument;
    if (current.parentCreatorId !== creatorId) {
      return NextResponse.json({ error: 'That sub-account belongs to a different creator.' }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

    if (typeof body.label === 'string') {
      const trimmed = body.label.trim();
      if (!trimmed) return NextResponse.json({ error: 'A label is required.' }, { status: 400 });

      const parentSnap = await adminDb.collection('creators').doc(creatorId).get();
      const parent = parentSnap.data() as CreatorFullDocument | undefined;
      patch.label = trimmed;
      patch.stageName = subAccountStageName(parent?.stageName ?? '', trimmed);
    }

    if (typeof body.OFID === 'string') patch.OFID = body.OFID.trim();
    if (typeof body.isArchived === 'boolean') patch.isArchived = body.isArchived;

    await ref.update(patch);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'admin/creators/subaccounts PATCH');
  }
});

export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ creatorId: string; subAccountId: string }>,
) => {
  try {
    const denied = await checkPageAccess(token.uid, 'admin-creator-management');
    if (denied) return denied;

    const { creatorId, subAccountId } = await params;

    const ref = adminDb.collection(SUBACCOUNTS).doc(subAccountId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });

    const current = snap.data() as CreatorSubAccountDocument;
    if (current.parentCreatorId !== creatorId) {
      return NextResponse.json({ error: 'That sub-account belongs to a different creator.' }, { status: 400 });
    }

    const assigned = await isAssigned(subAccountId);

    if (assigned === null) {
      return NextResponse.json(
        {
          error:
            'Could not check whether this account is used by any shift, so it was not deleted. Archive it instead — that removes it from every picker and is always safe.',
        },
        { status: 503 },
      );
    }

    if (assigned) {
      return NextResponse.json(
        {
          error:
            'This account is assigned to one or more shifts, which are used to work out pay. Archive it instead — that removes it from every picker and leaves past shifts readable.',
        },
        { status: 409 },
      );
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'admin/creators/subaccounts DELETE');
  }
});
