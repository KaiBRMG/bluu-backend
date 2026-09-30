import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { Timestamp } from 'firebase-admin/firestore';
import {
  GROWTH_POSTS,
  POST_LIST_HISTORY_LIMIT,
  checkGrowthAccess,
  getGrowthPost,
  serializeGrowthPost,
} from '@/lib/services/growthPostsService';
import { isReadHalted } from '@/lib/growth/metrics';
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
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    // Stopping or resuming is a person deciding about this post, so it clears
    // an automatic "Stopped after repeated failures" state. A Stopped post was
    // parked on the frozen `nextRefreshAt` sentinel to drop it out of the queue;
    // it is made due now so resuming actually reads it, and the next reading
    // puts it back on its age's rung of the ladder (or freezes it, if it is
    // past thirty days — the ordinary behaviour).
    // Trimmed like the list payload: the response replaces this post's row there.
    const post = serializeGrowthPost(snap, POST_LIST_HISTORY_LIMIT);
    const changed = body.isActive !== post.isActive;
    const unpark = changed && isReadHalted(post) ? Timestamp.now() : null;
    const update = {
      isActive: body.isActive,
      ...(changed ? { consecutiveFailures: 0 } : {}),
      ...(unpark ? { nextRefreshAt: unpark } : {}),
    };
    await ref.update(update);

    // The post as it now stands, so the client replaces its row rather than
    // re-deriving these side effects — the reset rule lives only here.
    return NextResponse.json({
      success: true,
      post: {
        ...post,
        isActive: body.isActive,
        ...(changed ? { consecutiveFailures: 0 } : {}),
        ...(unpark ? { nextRefreshAt: unpark.toDate().toISOString() } : {}),
      },
    });
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
