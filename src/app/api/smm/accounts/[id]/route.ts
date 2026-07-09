import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  SMM_ACCOUNTS,
  SMM_POSTS_SUB,
  SMM_SCHEDULE,
  checkSmmAccess,
  validateAccountFields,
} from '@/lib/services/smmService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** PATCH /api/smm/accounts/[id] — update an account (admin page only). */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;

    const invalid = validateAccountFields(body);
    if (invalid) return invalid;

    const ref = adminDb.collection(SMM_ACCOUNTS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const allowed = [
      'accountName', 'accountLink', 'type', 'network', 'tier',
      'assigned', 'driveLink', 'comments', 'information', 'status',
    ];
    const updates: Record<string, unknown> = {
      lastUpdatedTime: FieldValue.serverTimestamp(),
      lastUpdatedBy: token.uid,
    };
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    await ref.update(updates);

    // accountName is denormalized onto the account's posts — fan the rename
    // out so calendars and tables don't show a stale name. Renames are rare;
    // chunked batches keep this within the 500-op limit.
    const newName = updates.accountName;
    if (typeof newName === 'string' && newName !== snap.data()?.accountName) {
      const posts = await adminDb
        .collection(SMM_SCHEDULE).doc(id).collection(SMM_POSTS_SUB)
        .select()
        .get();
      for (let i = 0; i < posts.docs.length; i += 500) {
        const batch = adminDb.batch();
        for (const post of posts.docs.slice(i, i + 500)) {
          batch.update(post.ref, { accountName: newName });
        }
        await batch.commit();
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/smm/accounts/:id]', error);
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
  }
});

/**
 * DELETE /api/smm/accounts/[id] — delete an account and its content
 * schedule subtree (admin page only). Bonus submissions keep their
 * denormalized copies and are intentionally untouched.
 */
export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const { id } = await params;
    await adminDb.collection(SMM_ACCOUNTS).doc(id).delete();
    // Removes the posts subcollection (the shell parent doc never exists).
    await adminDb.recursiveDelete(adminDb.collection(SMM_SCHEDULE).doc(id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/smm/accounts/:id]', error);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
});
