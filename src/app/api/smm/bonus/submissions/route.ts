import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  SMM_ACCOUNTS,
  SMM_POSTS_SUB,
  SMM_SCHEDULE,
  SMM_SUBMISSIONS_SUB,
  checkSmmAccess,
  getCurrentRoundSnap,
  resolveUserInfo,
} from '@/lib/services/smmService';
import { SUGGESTION_SHARE, calculateBonus } from '@/lib/smm/bonusCalc';
import { normalizePostLink } from '@/lib/smm/linkUtils';
import { SMM_STATUS_QUALIFIED, isBonusAccountType } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { SmmNetwork } from '@/types/firestore';

/**
 * POST /api/smm/bonus/submissions — the bonus wizard submit.
 * All bonus math runs here; the client only collects inputs. userTotals is
 * NOT credited at submission time — it is credited when an admin approves the
 * submission (see the submission PATCH route).
 *
 * The viral-copy declaration is NOT taken from this request: it was captured
 * and verified when the post was scheduled, and is read back off the post doc.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'dashboard');
    if (denied) return denied;

    const body = await request.json() as {
      accountId?: string;
      postId?: string;
      numLikes?: number;
      screenshotLink?: string;
    };

    if (!body.accountId || !body.postId) {
      return NextResponse.json({ error: 'Post reference is required' }, { status: 400 });
    }
    const numLikes = Number(body.numLikes);
    if (!Number.isFinite(numLikes) || numLikes < 0) {
      return NextResponse.json({ error: 'A valid like count is required' }, { status: 400 });
    }

    // The post, account, and current round are independent reads — fetch in
    // parallel, then validate.
    const postRef = adminDb
      .collection(SMM_SCHEDULE).doc(body.accountId).collection(SMM_POSTS_SUB).doc(body.postId);
    const [postSnap, accountSnap, roundSnap] = await Promise.all([
      postRef.get(),
      adminDb.collection(SMM_ACCOUNTS).doc(body.accountId).get(),
      getCurrentRoundSnap(),
    ]);

    // 1. Post must exist and belong to the caller.
    if (!postSnap.exists) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    const post = postSnap.data()!;
    if (post.postedBy !== token.uid) {
      return NextResponse.json({ error: 'You can only submit your own posts' }, { status: 403 });
    }

    // 2. Account provides the frozen tier/network. Only bonus accounts (type
    //    contains 'Bonus') may be submitted, and those always carry a tier —
    //    the client shows the same message, but this is the enforcement.
    if (!accountSnap.exists) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    const account = accountSnap.data()!;
    if (!isBonusAccountType(account.type as string[])) {
      return NextResponse.json(
        { error: 'This is not a bonus account — its type must include "Bonus"' },
        { status: 400 },
      );
    }
    const tier = account.tier;
    if (tier !== 1 && tier !== 2) {
      return NextResponse.json(
        { error: 'This account has no tier — set one on the account before submitting' },
        { status: 400 },
      );
    }

    // 3. Require "now" inside the current round window.
    if (!roundSnap) {
      return NextResponse.json({ error: 'No active bonus round' }, { status: 400 });
    }
    const round = roundSnap.data()!;
    const now = Date.now();
    const startMs = round.roundDateStart?.toDate?.().getTime() ?? 0;
    const endMs = round.roundDateEnd?.toDate?.().getTime() ?? 0;
    if (now < startMs || now > endMs) {
      return NextResponse.json({ error: 'No active bonus round' }, { status: 400 });
    }

    // 4. The two other accounts a bonus can involve, both recorded on the post
    //    and both fetched in one getAll:
    //      - originalAcc: the page whose viral post was copied (residual)
    //      - sourceAcc:   the creator page the content was uploaded FROM. Its
    //                     network drives the network bonus (NOT the posting
    //                     page's — the manual pays for uploading *from* the
    //                     inhouse / X managed / twink lists), and its
    //                     `suggestedBy` earns the $2 page-suggestion share.
    const isViralCopy = post.isViralCopy === true;
    const originalLink = isViralCopy ? (post.originalLink as string) ?? '' : '';
    const originalNormalized = isViralCopy ? (post.originalLinkNormalized as string) ?? '' : '';
    const originalAccId = isViralCopy ? (post.originalAcc as string) ?? '' : '';
    const sourceAccId = (post.sourceAcc as string) ?? '';

    const extraIds = [originalAccId, sourceAccId].filter(Boolean);
    const extraSnaps = extraIds.length > 0
      ? await adminDb.getAll(...extraIds.map((id) => adminDb.collection(SMM_ACCOUNTS).doc(id)))
      : [];
    const byId = new Map(extraSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()!]));
    const originalAccount = originalAccId ? byId.get(originalAccId) ?? null : null;
    const sourceAccount = sourceAccId ? byId.get(sourceAccId) ?? null : null;

    // No recorded source ⇒ 'Other' ⇒ no network bonus.
    const sourceNetwork = (sourceAccount?.network ?? 'Other') as SmmNetwork;

    // 5. Reject a duplicate submission of this post in the current round.
    const postNormalized = (post.postLinkNormalized as string) ?? normalizePostLink(post.postLink ?? '');
    if (postNormalized) {
      const dupSnap = await roundSnap.ref
        .collection(SMM_SUBMISSIONS_SUB)
        .where('postLinkNormalized', '==', postNormalized)
        .limit(1)
        .get();
      if (!dupSnap.empty) {
        return NextResponse.json({ error: 'This post has already been submitted this round' }, { status: 400 });
      }
    }

    // 6. Compute the bonus (server-authoritative).
    const postDateMs = post.postDate?.toDate?.().getTime() ?? now;
    const result = calculateBonus({
      tier,
      network: sourceNetwork,
      numLikes,
      postDateMs,
      submissionDateMs: now,
      hasOriginalLink: isViralCopy,
    });

    // 7. Single batch: the submission (+ optional residual). No userTotals
    //    write — totals move on admin approval.
    const batch = adminDb.batch();
    const submissionDate = FieldValue.serverTimestamp();

    const subRef = roundSnap.ref.collection(SMM_SUBMISSIONS_SUB).doc();
    batch.set(subRef, {
      postLink: post.postLink ?? '',
      postLinkNormalized: postNormalized,
      accountName: post.accountName ?? account.accountName ?? '',
      originalLink,
      originalLinkNormalized: originalNormalized,
      originalAcc: originalAccId,
      submittedBy: token.uid,
      screenshotLink: body.screenshotLink?.trim() ?? '',
      postDate: post.postDate ?? Timestamp.fromMillis(postDateMs),
      submissionDate,
      numLikes,
      status: result.status,
      network: sourceNetwork,
      sourceAcc: sourceAccId,
      sourceAccName: (post.sourceAccName as string) ?? '',
      tier,
      bonusAmount: result.bonusAmount,
      sysComments: result.sysComments,
      adminApproval: 'pending',
      isResidual: false,
    });

    // Flag the source post so its calendar card shows the 💰 bonus indicator.
    batch.update(postRef, { bonusSubmission: true });

    // 8. Shares paid to OTHER SMMs off this submission. Both are their own
    //    pending submission docs, so an admin approves each on its own merits.
    //    They are independent and can both fire on one post.
    const suggestedBy = (sourceAccount?.suggestedBy as string) ?? '';
    // Rule 3️⃣: a flat $2 to whoever suggested the creator page this content
    // came from — "if a page you suggested was approved and ANOTHER SMM uses
    // their content", so never to the submitter themselves.
    const paysSuggestionShare = result.status === SMM_STATUS_QUALIFIED
      && !!suggestedBy
      && suggestedBy !== token.uid;

    const paysResidual = result.residualBonusAmount !== null && !!originalAccount?.assigned;
    // Both share comments name the submitter — resolve it once, and only when
    // a share is actually being written.
    const names = paysSuggestionShare || paysResidual ? await resolveUserInfo([token.uid]) : null;
    const submitterName = names?.get(token.uid)?.displayName ?? 'another SMM';

    /** Every share doc is this post's submission, re-pointed at another SMM. */
    const shareDoc = (recipient: string, amount: number, comment: string) => ({
      postLink: post.postLink ?? '',
      postLinkNormalized: '', // not the recipient's own post — keep out of dup checks
      accountName: post.accountName ?? account.accountName ?? '',
      originalLink,
      originalLinkNormalized: '',
      originalAcc: originalAccId,
      submittedBy: recipient,
      screenshotLink: '',
      postDate: post.postDate ?? Timestamp.fromMillis(postDateMs),
      submissionDate,
      numLikes,
      status: SMM_STATUS_QUALIFIED,
      network: sourceNetwork,
      sourceAcc: sourceAccId,
      sourceAccName: (post.sourceAccName as string) ?? '',
      tier,
      bonusAmount: amount,
      sysComments: comment,
      adminApproval: 'pending',
      isResidual: true,
    });

    // Rule 3️⃣ — the page-suggestion share.
    let suggestionShareCreated = false;
    if (paysSuggestionShare) {
      batch.set(
        roundSnap.ref.collection(SMM_SUBMISSIONS_SUB).doc(),
        shareDoc(
          suggestedBy,
          SUGGESTION_SHARE,
          `3️⃣ Page Suggestion share: $${SUGGESTION_SHARE} — ${(post.sourceAccName as string) || 'a page you suggested'} used by ${submitterName}`,
        ),
      );
      suggestionShareCreated = true;
    }

    // Rule 6️⃣ — residual for the copied account's owner (viral copy only).
    let residualCreated = false;
    if (paysResidual) {
      batch.set(
        roundSnap.ref.collection(SMM_SUBMISSIONS_SUB).doc(),
        shareDoc(
          originalAccount!.assigned as string,
          result.residualBonusAmount!,
          `6️⃣ Viral Post residual from ${submitterName}`,
        ),
      );
      residualCreated = true;
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      bonusAmount: result.bonusAmount,
      status: result.status,
      sysComments: result.sysComments,
      residualCreated,
      suggestionShareCreated,
    });
  } catch (error) {
    console.error('[POST /api/smm/bonus/submissions]', error);
    return NextResponse.json({ error: 'Failed to submit bonus' }, { status: 500 });
  }
});
