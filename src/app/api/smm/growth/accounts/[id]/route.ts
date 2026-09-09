import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  GROWTH_ACCOUNTS,
  checkGrowthAccess,
  serializeGrowthAccount,
} from '@/lib/services/growthTrackingService';
import {
  checkSpendCeiling,
  discoverPostsForAccounts,
} from '@/lib/services/growthPostsService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Switching post tracking on fires an immediate timeline search (10–30s), so
 * this route needs more than a default lambda's ten seconds.
 */
export const maxDuration = 60;

/**
 * PATCH /api/smm/growth/accounts/[id] — stop or resume tracking, or opt the
 * account into post-level tracking.
 *
 * "Remove" in the UI is `isActive: false`, not a delete: the account stops being
 * scraped (and stops costing money) while its history is kept and the account
 * can be resumed. Archive ≠ delete — the same principle as rule 6, applied here
 * because months of daily readings cannot be recovered once dropped.
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json() as { isActive?: boolean; trackPosts?: boolean };

    // `isActive` and `trackPosts` are the ONLY mutable fields. An account is
    // named by its handle and nothing else, and the handle — with the platform
    // and profile URL — is the identity the document id is built from, so
    // changing one would orphan the history rather than move it.
    const hasIsActive = typeof body.isActive === 'boolean';
    const hasTrackPosts = typeof body.trackPosts === 'boolean';
    if (!hasIsActive && !hasTrackPosts) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const ref = adminDb.collection(GROWTH_ACCOUNTS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Post tracking is an X-only feature: the tweet scraper takes X handles, and
    // there is no equivalent actor for Facebook page posts in this subsystem.
    // Refused rather than silently ignored, so a caller is never told a toggle
    // took effect when nothing will ever read that account's posts.
    const account = serializeGrowthAccount(snap);
    if (hasTrackPosts && account.platform !== 'twitter') {
      return NextResponse.json({
        error: 'Post tracking is only available for X accounts.',
      }, { status: 400 });
    }

    await ref.update({
      ...(hasIsActive ? { isActive: body.isActive } : {}),
      ...(hasTrackPosts ? { trackPosts: body.trackPosts } : {}),
    });

    // ── Switching post tracking ON searches straight away ────────────────────
    // Otherwise the toggle looks like it did nothing: the nightly pass would not
    // run for up to six hours, and the Posts tab would stay empty in the
    // meantime. This mirrors the account-add route, which also scrapes on the
    // spot rather than promising something for later.
    //
    // The toggle is saved FIRST and is never rolled back by a failed search. The
    // user's intent is "track this account", and a scraper hiccup should not
    // refuse it — the nightly pass retries on its own. The outcome is reported so
    // the UI can say what actually happened rather than claiming success.
    let discovery: { created: number; refreshed: number; error: string | null } | null = null;

    if (hasTrackPosts && body.trackPosts === true && !account.trackPosts && account.isActive) {
      // The money breaker still applies to a user-triggered search.
      const { blocked } = await checkSpendCeiling();
      if (blocked) {
        discovery = {
          created: 0,
          refreshed: 0,
          error: 'Post tracking is on, but the monthly budget has been reached — the first search will run once it resets.',
        };
      } else {
        const result = await discoverPostsForAccounts([{
          id,
          handle: account.handle,
          handleNormalized: account.handleNormalized,
        }]);
        discovery = {
          created: result.created,
          refreshed: result.refreshed,
          error: result.error
            ?? (result.emptyHandles.length > 0
              ? 'Post tracking is on, but the search found no posts for this account just now. The nightly pass will try again.'
              : null),
        };
      }
    }

    return NextResponse.json({ success: true, discovery });
  } catch (error) {
    return handleApiError(error, 'PATCH /api/smm/growth/accounts/[id]');
  }
});

/**
 * DELETE /api/smm/growth/accounts/[id] — permanent, including all history.
 *
 * Reachable only from the stopped list, behind a confirm that names what is
 * being destroyed. `recursiveDelete` takes the `series` subcollection with it —
 * rules do not cascade and neither does a document delete, so without this the
 * readings would linger unreachable.
 *
 * Posts discovered from this account are deliberately NOT deleted. They live in
 * their own top-level collection, they may have been pinned by hand as well, and
 * their engagement history is exactly as unrecoverable as the follower history —
 * so they are left to be stopped or deleted on their own terms.
 */
export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const { id } = await params;
    await adminDb.recursiveDelete(adminDb.collection(GROWTH_ACCOUNTS).doc(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'DELETE /api/smm/growth/accounts/[id]');
  }
});
