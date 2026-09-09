import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  GROWTH_POSTS,
  checkGrowthAccess,
  getGrowthPost,
} from '@/lib/services/growthPostsService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/growth/posts/[tweetId] — one post with its **full** reading
 * history, untrimmed.
 *
 * The list route ships a trimmed tail to keep a 300-post payload small; this is
 * where the detail view gets everything. One document read.
 */
export const GET = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ tweetId: string }>,
) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const { tweetId } = await params;
    const post = await getGrowthPost(tweetId);
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

    return NextResponse.json({ post });
  } catch (error) {
    return handleApiError(error, 'GET /api/smm/growth/posts/[tweetId]');
  }
});

/**
 * PATCH /api/smm/growth/posts/[tweetId] — stop or resume refreshing.
 *
 * "Stop" is `isActive: false`, not a delete: the post drops out of the refresh
 * queue (and stops costing money) while every reading is kept and one click
 * resumes it. Engagement history cannot be re-collected — the scraper only ever
 * returns a post's numbers *now* — so the same archive-≠-delete principle that
 * governs accounts governs posts.
 *
 * `isActive` is the only mutable field. Everything else about a post is either
 * its identity (the tweet id) or a scraper reading, and neither is ours to edit.
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ tweetId: string }>,
) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const { tweetId } = await params;
    const body = await request.json() as { isActive?: boolean };
    if (typeof body.isActive !== 'boolean') {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const ref = adminDb.collection(GROWTH_POSTS).doc(tweetId);
    if (!(await ref.get()).exists) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    await ref.update({ isActive: body.isActive });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'PATCH /api/smm/growth/posts/[tweetId]');
  }
});

/**
 * DELETE /api/smm/growth/posts/[tweetId] — permanent, including every reading.
 *
 * Reachable only from the stopped list, behind a confirm that names what is
 * being destroyed. A plain delete is enough here: readings live in a map on the
 * document itself, so unlike an account there is no subcollection to strand.
 */
export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ tweetId: string }>,
) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const { tweetId } = await params;
    await adminDb.collection(GROWTH_POSTS).doc(tweetId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'DELETE /api/smm/growth/posts/[tweetId]');
  }
});
