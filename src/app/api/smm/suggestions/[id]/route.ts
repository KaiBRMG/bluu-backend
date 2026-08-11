import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  SMM_ACCOUNTS,
  SMM_SUGGESTIONS,
  checkSmmAccess,
} from '@/lib/services/smmService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Locate the suggested account. Handles are stored with inconsistent casing
 * (the imported sheet is upper-case, a pasted link may not be), so the three
 * casings are matched in one `in` query rather than scanning the collection.
 */
async function findAccountByHandle(handle: string) {
  const variants = [...new Set([handle, handle.toUpperCase(), handle.toLowerCase()])];
  const snap = await adminDb
    .collection(SMM_ACCOUNTS)
    .where('accountName', 'in', variants)
    .limit(1)
    .get();
  return snap.docs[0] ?? null;
}

/**
 * PATCH /api/smm/suggestions/[id] — approve or deny a viral-page suggestion
 * (admin page only).
 *
 * Approve marks the named account `isViralBonus: true`. When no such account
 * exists the request is answered with `{ accountMissing: true }` and nothing is
 * written — the client warns the admin, who may retry with `createAccount:true`
 * to register the account from the suggestion's details.
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json() as { action?: 'approve' | 'deny'; createAccount?: boolean };
    if (body.action !== 'approve' && body.action !== 'deny') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const ref = adminDb.collection(SMM_SUGGESTIONS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }
    const suggestion = snap.data()!;

    if (body.action === 'deny') {
      await ref.update({
        isRejected: true,
        reviewedBy: token.uid,
        reviewedTime: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ success: true });
    }

    const accountName = (suggestion.accountName as string) ?? '';
    const existing = accountName ? await findAccountByHandle(accountName) : null;

    if (!existing && !body.createAccount) {
      return NextResponse.json({ success: false, accountMissing: true, accountName });
    }

    // `suggestedBy` is what earns the suggester the $2 share on every bonus a
    // post from this page later hits (rule 3️⃣). It is only set on approval, and
    // an existing suggester is never overwritten — the first approved
    // suggestion owns the page.
    const suggester = (suggestion.submittedBy as string) ?? '';
    const batch = adminDb.batch();
    if (existing) {
      batch.update(existing.ref, {
        isViralBonus: true,
        ...(existing.data()?.suggestedBy ? {} : { suggestedBy: suggester || null }),
        lastUpdatedTime: FieldValue.serverTimestamp(),
        lastUpdatedBy: token.uid,
      });
    } else {
      // Created from the suggestion alone — every other field is left blank for
      // an admin to fill in from the Account Database.
      batch.set(adminDb.collection(SMM_ACCOUNTS).doc(), {
        accountName,
        accountLink: (suggestion.accountLink as string) ?? '',
        type: [],
        network: 'Other',
        tier: null,
        isViralBonus: true,
        suggestedBy: suggester || null,
        assigned: null,
        driveLink: '',
        comments: '',
        information: '',
        status: 'active',
        lastUpdatedTime: FieldValue.serverTimestamp(),
        lastUpdatedBy: token.uid,
      });
    }
    batch.update(ref, {
      isApproved: true,
      reviewedBy: token.uid,
      reviewedTime: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return NextResponse.json({ success: true, created: !existing });
  } catch (error) {
    console.error('[PATCH /api/smm/suggestions/:id]', error);
    return NextResponse.json({ error: 'Failed to update suggestion' }, { status: 500 });
  }
});
