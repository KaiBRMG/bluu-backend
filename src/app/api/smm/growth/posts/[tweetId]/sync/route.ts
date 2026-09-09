import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  MANUAL_SYNC_COOLDOWN_MS,
  MIN_BILLED_RESULTS,
  checkGrowthAccess,
  checkSpendCeiling,
  getGrowthPost,
  recordPostFailures,
  recordPostReadings,
  recordSpend,
  runTweetLookup,
  spendCeilingResponse,
  stalestPostsForPadding,
  stampManualSync,
  type PostReading,
} from '@/lib/services/growthPostsService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** A scraper call, so more than a default lambda's ten seconds. */
export const maxDuration = 60;

/**
 * POST /api/smm/growth/posts/[tweetId]/sync — read this post now.
 *
 * ── The cooldown is server-side, and that is the point ──────────────────────
 * A client-side timer is not a cooldown (cross-cutting rule 10): it is a
 * suggestion anyone can skip with a devtools console, and every skip spends
 * money. `lastManualSyncAt` lives on the document, is written by this route, and
 * is what a second request is refused against.
 *
 * ── The call carries nineteen other posts, deliberately ─────────────────────
 * The actor bills a floor of 20 results whatever the batch size, so syncing one
 * post and syncing twenty cost the same. The target therefore rides along with
 * the nineteen stalest tracked posts, which get a free reading. A single-id call
 * here would be the most expensive control in the whole feature — twenty times
 * the marginal cost for one twentieth of the data.
 */
export const POST = withAuth(async (
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

    if (post.lastManualSyncAt) {
      const elapsed = Date.now() - Date.parse(post.lastManualSyncAt);
      if (elapsed < MANUAL_SYNC_COOLDOWN_MS) {
        const waitMinutes = Math.ceil((MANUAL_SYNC_COOLDOWN_MS - elapsed) / 60_000);
        return NextResponse.json({
          error: `This post was refreshed by hand less than ${Math.round(MANUAL_SYNC_COOLDOWN_MS / 60_000)} minutes ago. Try again in ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'} — engagement rarely moves enough in that window to be worth another read.`,
          retryAfterMs: MANUAL_SYNC_COOLDOWN_MS - elapsed,
        }, { status: 429 });
      }
    }

    const { blocked, ledger } = await checkSpendCeiling();
    if (blocked) return spendCeilingResponse(ledger);

    const padding = await stalestPostsForPadding(MIN_BILLED_RESULTS - 1, [tweetId]);
    const call = await runTweetLookup([tweetId, ...padding.map((p) => p.id)]);
    await recordSpend(call.billedResults);

    const byId = new Map(call.results.map((p) => [p.tweetId, p]));
    const readings: PostReading[] = [];
    for (const candidate of [post, ...padding]) {
      const scraped = byId.get(candidate.id);
      if (scraped) readings.push({ post: scraped, existing: candidate });
    }
    await recordPostReadings(readings);

    // Stamped whether or not the target resolved: the call was billed either
    // way, so a post that has been deleted must not become a free retry loop.
    await recordPostFailures(
      byId.has(tweetId) ? [] : [{ id: tweetId, postedAt: post.postedAt }],
      'The scraper returned nothing for this post. It may have been deleted, or the account may have been made private.',
    );
    await stampManualSync(tweetId);

    if (!byId.has(tweetId)) {
      return NextResponse.json({
        error: 'We could not read that post just now. It may have been deleted, or the account may be private — its existing readings have been kept.',
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      post: await getGrowthPost(tweetId),
      refreshedAlongside: readings.length - 1,
      estimatedCostUsd: Number(call.costUsd.toFixed(4)),
    });
  } catch (error) {
    return handleApiError(error, 'POST /api/smm/growth/posts/[tweetId]/sync');
  }
});
