import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  MAX_TRACKED_POSTS,
  MIN_BILLED_RESULTS,
  checkGrowthAccess,
  checkSpendCeiling,
  countGrowthPosts,
  getGrowthPost,
  listGrowthPosts,
  readSpendLedger,
  recordPostReadings,
  recordSpend,
  runTweetLookup,
  spendCeilingResponse,
  stalestPostsForPadding,
  type PostReading,
} from '@/lib/services/growthPostsService';
import { parsePostLink } from '@/lib/growth/postLink';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Adding a post fires a validating scraper call (10–30s), so this route needs
 * more than a default lambda's ten seconds.
 */
export const maxDuration = 60;

/**
 * GET /api/smm/growth/posts — every tracked post, plus the month's spend.
 *
 * History is trimmed to the most recent readings on the wire: the ladder puts a
 * post at ~15 readings over its life, so the trim only ever bites on posts that
 * have been manually synced repeatedly, and the detail route serves the full
 * series when someone actually opens one.
 *
 * Bounded by `MAX_TRACKED_POSTS`, so this is at most 300 reads for the whole
 * page — the client slices ranges in memory afterwards rather than re-fetching
 * per click, the same trade the follower series makes (rule 9).
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const [posts, spend] = await Promise.all([listGrowthPosts(), readSpendLedger()]);
    return NextResponse.json({ posts, spend });
  } catch (error) {
    return handleApiError(error, 'GET /api/smm/growth/posts');
  }
});

/**
 * POST /api/smm/growth/posts — start tracking a post from its link.
 *
 * The add is validated by an immediate scraper call and is **all-or-nothing**: a
 * link the actor cannot resolve writes nothing at all. A typo must not become a
 * document that bills on every refresh cycle forever while showing an empty
 * chart. That call doubles as reading zero, so a newly tracked post has numbers
 * straight away instead of waiting for the next cron.
 *
 * ── Why the call carries nineteen other posts ───────────────────────────────
 * The actor's floor is 20 results, billed whether or not the batch fills it. A
 * one-id call therefore costs exactly what a twenty-id call costs, so the target
 * rides along with the nineteen stalest tracked posts and those readings are
 * free. Declining to take them would not save a cent (RULE 3 in the service).
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const body = await request.json() as { url?: string };
    const parsed = parsePostLink(body.url ?? '');
    if (!parsed) {
      return NextResponse.json({
        error: 'That does not look like an X post link. Paste the link to the post itself, for example https://x.com/TwinkLoad/status/1839472016382939136.',
      }, { status: 400 });
    }

    // The tweet id is the document id, so the duplicate check is one read.
    const existing = await getGrowthPost(parsed.tweetId);
    if (existing) {
      return NextResponse.json({
        error: existing.isActive
          ? 'That post is already being tracked.'
          : 'That post was tracked before. Resume it from the stopped list instead of adding it again — its readings are still there.',
        existingId: existing.id,
        isActive: existing.isActive,
      }, { status: 409 });
    }

    // The roster breaker is checked on the way in, where it can still be refused
    // with an explanation, as well as in the cron.
    const count = await countGrowthPosts();
    if (count >= MAX_TRACKED_POSTS) {
      return NextResponse.json({
        error: `The tracked-post limit of ${MAX_TRACKED_POSTS} has been reached. Stop tracking a post first, or raise the limit deliberately — every tracked post adds to the refresh cost.`,
      }, { status: 400 });
    }

    // The money breaker. Refused before spending, not after.
    const { blocked, ledger } = await checkSpendCeiling();
    if (blocked) return spendCeilingResponse(ledger);

    const padding = await stalestPostsForPadding(MIN_BILLED_RESULTS - 1, [parsed.tweetId]);
    const call = await runTweetLookup([parsed.tweetId, ...padding.map((p) => p.id)]);
    await recordSpend(call.billedResults);

    const byId = new Map(call.results.map((p) => [p.tweetId, p]));
    const target = byId.get(parsed.tweetId);

    // The free readings were paid for whether or not the target resolved, so
    // they are recorded either way — including on the failure path below.
    const paddingReadings: PostReading[] = padding
      .filter((p) => byId.has(p.id))
      .map((p) => ({ post: byId.get(p.id)!, existing: p }));

    if (!target) {
      if (paddingReadings.length > 0) await recordPostReadings(paddingReadings);
      return NextResponse.json({
        error: 'We could not find that post. Check the link opens the post you expect — it may have been deleted, or the account may be private. Nothing has been saved.',
      }, { status: 400 });
    }

    await recordPostReadings([
      {
        post: target,
        existing: null,
        create: { source: 'manual', accountId: null, addedBy: token.uid },
      },
      ...paddingReadings,
    ]);

    return NextResponse.json({
      success: true,
      id: parsed.tweetId,
      refreshedAlongside: paddingReadings.length,
      estimatedCostUsd: Number(call.costUsd.toFixed(4)),
    });
  } catch (error) {
    return handleApiError(error, 'POST /api/smm/growth/posts');
  }
});
