/**
 * GET  /api/admin/creators/[creatorId]/subaccounts — list, including archived
 * POST /api/admin/creators/[creatorId]/subaccounts — add one
 *
 * A sub-account is a second account the creator runs (Cole on OnlyFans, "Cole
 * (Fansly)" on Fansly). For shift assignment and pay it is a **peer** of its
 * parent, not a child: one agent can hold Cole and another Cole (Fansly), and
 * each counts as one account toward whoever holds it.
 *
 * It is deliberately not a `creators` document — see the note on
 * `CreatorSubAccountDocument`. No auth uid, no portal login, no Telegram
 * binding: it is an account someone owns, not a person.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, checkPageAccess } from '@/lib/middleware/apiHelpers';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getSubAccountsForCreator, subAccountStageName } from '@/lib/services/creatorAccountService';
import type { CreatorFullDocument } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

const SUBACCOUNTS = 'creator-subaccounts';
const MAX_LABEL = 40;

function serialise(doc: Record<string, unknown>) {
  return {
    ...doc,
    createdAt: (doc.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? null,
    updatedAt: (doc.updatedAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? null,
  };
}

export const GET = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ creatorId: string }>,
) => {
  try {
    const denied = await checkPageAccess(token.uid, 'admin-creator-management');
    if (denied) return denied;

    const { creatorId } = await params;
    const subAccounts = await getSubAccountsForCreator(creatorId);
    return NextResponse.json({ subAccounts: subAccounts.map(s => serialise(s as unknown as Record<string, unknown>)) });
  } catch (err) {
    return handleApiError(err, 'admin/creators/subaccounts GET');
  }
});

export const POST = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ creatorId: string }>,
) => {
  try {
    const denied = await checkPageAccess(token.uid, 'admin-creator-management');
    if (denied) return denied;

    const { creatorId } = await params;
    const { label, OFID } = (await request.json()) as { label?: string; OFID?: string };

    const trimmed = (label ?? '').trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'A label is required, e.g. "Fansly".' }, { status: 400 });
    }
    if (trimmed.length > MAX_LABEL) {
      return NextResponse.json({ error: `Keep the label under ${MAX_LABEL} characters.` }, { status: 400 });
    }

    const parentSnap = await adminDb.collection('creators').doc(creatorId).get();
    if (!parentSnap.exists) {
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 });
    }
    const parent = parentSnap.data() as CreatorFullDocument;
    if (parent.isArchived) {
      return NextResponse.json({ error: 'That creator is archived.' }, { status: 400 });
    }

    // One label per creator. Two "Fansly" rows under Cole would render as two
    // identical chips an admin could not tell apart when assigning a shift.
    const existing = await getSubAccountsForCreator(creatorId);
    if (existing.some(s => !s.isArchived && s.label.toLowerCase() === trimmed.toLowerCase())) {
      return NextResponse.json({ error: `${parent.stageName} already has a "${trimmed}" account.` }, { status: 409 });
    }

    const ref = adminDb.collection(SUBACCOUNTS).doc();
    await ref.set({
      subAccountId: ref.id,
      parentCreatorId: creatorId,
      label: trimmed,
      // Stored rather than derived on read so a rename of the parent does not
      // silently rewrite history on shifts already assigned to this account.
      stageName: subAccountStageName(parent.stageName, trimmed),
      OFID: (OFID ?? '').trim(),
      // Null, not the parent's URL: inheritance is resolved on read, so a new
      // photo on the parent reaches every sub-account that never set its own.
      photoURL: null,
      photoThumb: null,
      photoStoragePath: null,
      isArchived: false,
      createdBy: token.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, subAccountId: ref.id });
  } catch (err) {
    return handleApiError(err, 'admin/creators/subaccounts POST');
  }
});
