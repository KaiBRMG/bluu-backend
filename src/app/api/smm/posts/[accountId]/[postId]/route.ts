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
  findDuplicatePostLink,
  isSmmAdmin,
} from '@/lib/services/smmService';
import { accountHandle, linkMatchesHandle, normalizePostLink } from '@/lib/smm/linkUtils';
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

    // `sourceAcc` is deliberately NOT on this allowlist: it is derived from the
    // viral-copy declaration (the account the original post lives on), and that
    // declaration is itself immutable after upload. Letting it be edited here
    // would let an SMM re-point a post at a better-paying network after the
    // fact — the network bonus is exactly what it decides.

    const newAccountId = typeof body.accountId === 'string' ? body.accountId : accountId;
    const moving = newAccountId !== accountId;
    const linkChanged = typeof updates.postLink === 'string';

    // One read shared by the move's authorization check and the link/handle
    // check below.
    const accountSnap = (moving || linkChanged)
      ? await adminDb.collection(SMM_ACCOUNTS).doc(newAccountId).get()
      : null;

    if (moving) {
      const accountDenied = await assertAccountWritable(token.uid, accountSnap!);
      if (accountDenied) return accountDenied;
    }

    // A rewritten link must still be a post on the account the post ends up on
    // — the same invariant the create route enforces. A pure move is left
    // alone: the link was already verified against a page, and re-checking it
    // here would block the admin Content tab's post-move dropdown.
    if (linkChanged) {
      const newLink = (updates.postLink as string).trim();
      const handle = accountHandle(accountSnap!.data() ?? {});
      if (!linkMatchesHandle(newLink, handle)) {
        return NextResponse.json(
          { error: `The post link must be a post on @${handle || 'the selected account'}.` },
          { status: 400 },
        );
      }
      // The post's own declared copy source can't also be its own link.
      const normalized = updates.postLinkNormalized as string;
      if (normalized && normalized === (loaded.data()?.originalLinkNormalized ?? '')) {
        return NextResponse.json(
          { error: 'The post link cannot be the same as the original (viral copy) link.' },
          { status: 400 },
        );
      }
      // …and it can't be a post already in the schedule. The post excludes
      // itself: its own link is in there by definition.
      if (await findDuplicatePostLink(normalized, { accountId, postId })) {
        return NextResponse.json(
          { error: 'This post already exists in the content schedule.' },
          { status: 409 },
        );
      }
    }

    if (moving) {
      const account = accountSnap!.data()!;

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
