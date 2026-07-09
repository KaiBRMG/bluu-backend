import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  SMM_ACCOUNTS,
  SMM_POSTS_SUB,
  SMM_SCHEDULE,
  assertAccountWritable,
  checkSmmAccess,
  isSmmAdmin,
} from '@/lib/services/smmService';
import { normalizePostLink } from '@/lib/smm/linkUtils';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

function postRef(accountId: string, postId: string) {
  return adminDb.collection(SMM_SCHEDULE).doc(accountId).collection(SMM_POSTS_SUB).doc(postId);
}

/** Owner-or-admin gate shared by PATCH and DELETE. */
async function loadOwnedPost(
  uid: string,
  accountId: string,
  postId: string,
): Promise<DocumentSnapshot | NextResponse> {
  const snap = await postRef(accountId, postId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }
  if (snap.data()?.postedBy !== uid && !(await isSmmAdmin(uid))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  return snap;
}

/**
 * PATCH /api/smm/posts/[accountId]/[postId]
 * Allowlisted edits; changing accountId moves the post to the new account's
 * subcollection (batched set + delete) and re-denormalizes accountName.
 * Responds with the post's (possibly new) location.
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ accountId: string; postId: string }>,
) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'either');
    if (denied) return denied;

    const { accountId, postId } = await params;
    const body = await request.json() as Record<string, unknown>;

    const loaded = await loadOwnedPost(token.uid, accountId, postId);
    if (loaded instanceof NextResponse) return loaded;

    const updates: Record<string, unknown> = {};
    for (const key of ['caption', 'postLink']) {
      if (key in body && typeof body[key] === 'string') updates[key] = body[key];
    }
    if (typeof body.postDate === 'string') {
      const postDate = new Date(body.postDate);
      if (Number.isNaN(postDate.getTime())) {
        return NextResponse.json({ error: 'Invalid post date' }, { status: 400 });
      }
      updates.postDate = Timestamp.fromDate(postDate);
    }
    if (typeof updates.postLink === 'string') {
      updates.postLinkNormalized = normalizePostLink(updates.postLink);
    }

    const newAccountId = typeof body.accountId === 'string' ? body.accountId : accountId;

    if (newAccountId !== accountId) {
      const accountSnap = await adminDb.collection(SMM_ACCOUNTS).doc(newAccountId).get();
      const accountDenied = await assertAccountWritable(token.uid, accountSnap);
      if (accountDenied) return accountDenied;
      const account = accountSnap.data()!;

      const newRef = adminDb
        .collection(SMM_SCHEDULE).doc(newAccountId).collection(SMM_POSTS_SUB).doc();
      const batch = adminDb.batch();
      batch.set(newRef, { ...loaded.data(), ...updates, accountName: account.accountName ?? '' });
      batch.delete(loaded.ref);
      await batch.commit();
      return NextResponse.json({ success: true, accountId: newAccountId, postId: newRef.id });
    }

    if (Object.keys(updates).length > 0) {
      await loaded.ref.update(updates);
    }
    return NextResponse.json({ success: true, accountId, postId });
  } catch (error) {
    console.error('[PATCH /api/smm/posts/:accountId/:postId]', error);
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
  }
});

/** DELETE /api/smm/posts/[accountId]/[postId] — owner or admin-page user. */
export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ accountId: string; postId: string }>,
) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'either');
    if (denied) return denied;

    const { accountId, postId } = await params;
    const loaded = await loadOwnedPost(token.uid, accountId, postId);
    if (loaded instanceof NextResponse) return loaded;

    await loaded.ref.delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/smm/posts/:accountId/:postId]', error);
    return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 });
  }
});
