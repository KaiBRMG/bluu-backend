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
  findLinkUsage,
  getCurrentRoundSnap,
  resolveUserInfo,
} from '@/lib/services/smmService';
import { calculateBonus } from '@/lib/smm/bonusCalc';
import { normalizePostLink } from '@/lib/smm/linkUtils';
import { SMM_STATUS_QUALIFIED } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

const ELIGIBLE_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/smm/bonus/submissions — the bonus wizard submit.
 * All bonus math runs here; the client only collects inputs. userTotals is
 * NOT credited at submission time — it is credited when an admin approves the
 * submission (see the submission PATCH route).
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'dashboard');
    if (denied) return denied;

    const body = await request.json() as {
      accountId?: string;
      postId?: string;
      originalLink?: string;
      originalAccId?: string;
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

    // 2. Account provides the frozen tier/network.
    if (!accountSnap.exists) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    const account = accountSnap.data()!;

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

    // 4. Viral-copy path: re-verify eligibility server-side (never trust the
    //    client) and resolve the original account for residual routing.
    const originalLink = body.originalLink?.trim() ?? '';
    const originalNormalized = normalizePostLink(originalLink);
    let originalAccount: FirebaseFirestore.DocumentData | null = null;
    if (originalLink) {
      const usage = await findLinkUsage(originalNormalized);
      if (usage && usage.refDate) {
        const daysDiff = Math.floor((now - new Date(usage.refDate).getTime()) / DAY_MS);
        if (daysDiff <= ELIGIBLE_AFTER_DAYS) {
          return NextResponse.json({ error: 'This post has been used too recently to qualify' }, { status: 400 });
        }
      }
      if (body.originalAccId) {
        const origSnap = await adminDb.collection(SMM_ACCOUNTS).doc(body.originalAccId).get();
        if (origSnap.exists) originalAccount = origSnap.data()!;
      }
    }

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
      tier: (account.tier ?? 1) as 1 | 2,
      network: account.network ?? 'Other',
      numLikes,
      postDateMs,
      submissionDateMs: now,
      hasOriginalLink: !!originalLink,
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
      originalAcc: body.originalAccId ?? '',
      submittedBy: token.uid,
      screenshotLink: body.screenshotLink?.trim() ?? '',
      postDate: post.postDate ?? Timestamp.fromMillis(postDateMs),
      submissionDate,
      numLikes,
      status: result.status,
      network: account.network ?? 'Other',
      tier: account.tier ?? 1,
      bonusAmount: result.bonusAmount,
      sysComments: result.sysComments,
      adminApproval: 'pending',
      isResidual: false,
    });

    // Flag the source post so its calendar card shows the 💰 bonus indicator.
    batch.update(postRef, { bonusSubmission: true });

    // Residual for the original account's owner (viral copy only).
    let residualCreated = false;
    if (result.residualBonusAmount !== null && originalAccount?.assigned) {
      const names = await resolveUserInfo([token.uid]);
      const submitterName = names.get(token.uid)?.displayName ?? 'another SMM';
      const residualRef = roundSnap.ref.collection(SMM_SUBMISSIONS_SUB).doc();
      batch.set(residualRef, {
        postLink: post.postLink ?? '',
        postLinkNormalized: '', // residual isn't the owner's own post — keep out of dup checks
        accountName: post.accountName ?? account.accountName ?? '',
        originalLink,
        originalLinkNormalized: '',
        originalAcc: body.originalAccId ?? '',
        submittedBy: originalAccount.assigned,
        screenshotLink: '',
        postDate: post.postDate ?? Timestamp.fromMillis(postDateMs),
        submissionDate,
        numLikes,
        status: SMM_STATUS_QUALIFIED,
        network: account.network ?? 'Other',
        tier: account.tier ?? 1,
        bonusAmount: result.residualBonusAmount,
        sysComments: `6️⃣ Viral Post residual from ${submitterName}`,
        adminApproval: 'pending',
        isResidual: true,
      });
      residualCreated = true;
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      bonusAmount: result.bonusAmount,
      status: result.status,
      sysComments: result.sysComments,
      residualCreated,
    });
  } catch (error) {
    console.error('[POST /api/smm/bonus/submissions]', error);
    return NextResponse.json({ error: 'Failed to submit bonus' }, { status: 500 });
  }
});
