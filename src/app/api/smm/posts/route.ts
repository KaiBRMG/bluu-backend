import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  SMM_ACCOUNTS,
  SMM_POSTS_SUB,
  SMM_SCHEDULE,
  assertAccountWritable,
  checkSmmAccess,
  checkViralEligibility,
  findDuplicatePostLink,
  isSmmAdmin,
  resolveOriginalAccount,
  resolveUserInfo,
  serializePost,
} from '@/lib/services/smmService';
import { accountHandle, linkMatchesHandle, normalizePostLink } from '@/lib/smm/linkUtils';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { SmmPost } from '@/types/firestore';

const ALL_POSTS_PAGE_SIZE = 10;
const ALL_POSTS_CAP = 500;

/**
 * Drop posts whose parent account is inactive or gone (SMM.md hard rule:
 * inactive accounts must never surface on the dashboard). One batched
 * getAll over the unique parent account ids.
 */
async function filterActiveAccountPosts(docs: QueryDocumentSnapshot[]): Promise<SmmPost[]> {
  const posts = docs.map(serializePost);
  const accountIds = [...new Set(posts.map((p) => p.accountId).filter(Boolean))];
  if (accountIds.length === 0) return [];
  const snaps = await adminDb.getAll(
    ...accountIds.map((id) => adminDb.collection(SMM_ACCOUNTS).doc(id)),
  );
  const active = new Set(
    snaps.filter((s) => s.exists && s.data()?.status === 'active').map((s) => s.id),
  );
  return posts.filter((p) => active.has(p.accountId));
}

/**
 * GET /api/smm/posts
 *  - ?view=week&start=ISO&end=ISO — caller's posts in a date range (calendar)
 *  - ?view=all&page=N            — caller's posts, newest first, paginated
 *  - ?accountId=X                — one account's posts (account dialog Content tab)
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const params = request.nextUrl.searchParams;
    const accountId = params.get('accountId');

    if (accountId) {
      const denied = await checkSmmAccess(token.uid, 'either');
      if (denied) return denied;

      const accountSnap = await adminDb.collection(SMM_ACCOUNTS).doc(accountId).get();
      if (!accountSnap.exists) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      }
      // Admin-page users may open any account; dashboard users only their own
      // active accounts.
      if (!(await isSmmAdmin(token.uid))) {
        const data = accountSnap.data();
        if (data?.assigned !== token.uid || data?.status !== 'active') {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }
      }

      const snap = await adminDb
        .collection(SMM_SCHEDULE).doc(accountId).collection(SMM_POSTS_SUB)
        .orderBy('postDate', 'desc')
        .get();
      return NextResponse.json({ posts: snap.docs.map(serializePost) });
    }

    const view = params.get('view') ?? 'week';
    const scope = params.get('scope');

    // Admin content-schedule calendar: every user's posts in a date range,
    // with postedBy resolved for the card avatars. Admin-page gated.
    if (view === 'week' && scope === 'all') {
      const adminDenied = await checkSmmAccess(token.uid, 'admin');
      if (adminDenied) return adminDenied;

      const start = new Date(params.get('start') ?? '');
      const end = new Date(params.get('end') ?? '');
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
      }
      const snap = await adminDb
        .collectionGroup(SMM_POSTS_SUB)
        .where('postDate', '>=', Timestamp.fromDate(start))
        .where('postDate', '<=', Timestamp.fromDate(end))
        .get();
      const posts = await filterActiveAccountPosts(snap.docs);
      const names = await resolveUserInfo(posts.map((p) => p.postedBy));
      for (const p of posts) {
        p.postedByName = names.get(p.postedBy)?.displayName ?? '';
        p.postedByPhotoURL = names.get(p.postedBy)?.photoURL ?? null;
      }
      return NextResponse.json({ posts });
    }

    const denied = await checkSmmAccess(token.uid, 'dashboard');
    if (denied) return denied;

    if (view === 'all') {
      const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1);
      const snap = await adminDb
        .collectionGroup(SMM_POSTS_SUB)
        .where('postedBy', '==', token.uid)
        .orderBy('postDate', 'desc')
        .limit(ALL_POSTS_CAP)
        .get();
      const posts = await filterActiveAccountPosts(snap.docs);
      const totalPages = Math.max(1, Math.ceil(posts.length / ALL_POSTS_PAGE_SIZE));
      return NextResponse.json({
        posts: posts.slice((page - 1) * ALL_POSTS_PAGE_SIZE, page * ALL_POSTS_PAGE_SIZE),
        total: posts.length,
        totalPages,
      });
    }

    // view=week
    const start = new Date(params.get('start') ?? '');
    const end = new Date(params.get('end') ?? '');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
    }
    const snap = await adminDb
      .collectionGroup(SMM_POSTS_SUB)
      .where('postedBy', '==', token.uid)
      .where('postDate', '>=', Timestamp.fromDate(start))
      .where('postDate', '<=', Timestamp.fromDate(end))
      .get();
    const posts = await filterActiveAccountPosts(snap.docs);
    return NextResponse.json({ posts });
  } catch (error) {
    console.error('[GET /api/smm/posts]', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
  }
});

/** POST /api/smm/posts — schedule a post on one of the caller's accounts. */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'either');
    if (denied) return denied;

    const body = await request.json() as {
      accountId?: string;
      caption?: string;
      postDate?: string;
      postLink?: string;
      originalLink?: string;
    };

    if (!body.accountId || !body.postDate) {
      return NextResponse.json({ error: 'Account and post date are required' }, { status: 400 });
    }
    const postDate = new Date(body.postDate);
    if (Number.isNaN(postDate.getTime())) {
      return NextResponse.json({ error: 'Invalid post date' }, { status: 400 });
    }

    // Never trust the dropdown: re-verify the account server-side.
    const accountSnap = await adminDb.collection(SMM_ACCOUNTS).doc(body.accountId).get();
    const accountDenied = await assertAccountWritable(token.uid, accountSnap);
    if (accountDenied) return accountDenied;
    const account = accountSnap.data()!;

    // The link must be a post on the account it is being filed under. The
    // dropdown decides the tier and ownership, so a post linking to a different
    // page is unverifiable — and the client check is never trusted.
    const postLink = body.postLink?.trim() ?? '';
    const handle = accountHandle(account);
    if (!linkMatchesHandle(postLink, handle)) {
      return NextResponse.json(
        { error: `The post link must be a post on @${handle || account.accountName || 'the selected account'}.` },
        { status: 400 },
      );
    }

    const originalLink = body.originalLink?.trim() ?? '';
    const originalNormalized = normalizePostLink(originalLink);
    const postNormalized = normalizePostLink(postLink);

    // The post link is the NEW upload; the original is the post it copied. The
    // same link in both means no new upload is being recorded at all. Pure
    // string work, so it runs before anything touches Firestore.
    if (originalNormalized && postNormalized === originalNormalized) {
      return NextResponse.json(
        { error: 'The post link cannot be the same as the original (viral copy) link — record the new upload on your own account.' },
        { status: 400 },
      );
    }

    // Everything left is a Firestore lookup and nothing downstream depends on
    // another's result, so they all go out at once rather than in sequence.
    const [duplicate, eligibility, original] = await Promise.all([
      findDuplicatePostLink(postNormalized),
      // Viral-copy declaration, captured at upload time (not at bonus time).
      // The client already ran the same check for the "⚠️ Already Used
      // Recently" card, but its answer is never trusted — a copy is only
      // recorded if the source still qualifies here.
      originalNormalized ? checkViralEligibility(originalNormalized) : null,
      // The creator page the content was uploaded FROM is the account the
      // copied original lives on — derived from the link here, never sent by
      // the client, since it decides the network bonus and the suggester's $2
      // share.
      originalLink ? resolveOriginalAccount(originalLink) : null,
    ]);

    if (duplicate) {
      return NextResponse.json(
        { error: 'This post already exists in the content schedule.' },
        { status: 409 },
      );
    }

    let source = { id: '', name: '' };
    if (originalLink) {
      if (!originalNormalized) {
        return NextResponse.json({ error: 'Invalid original post link' }, { status: 400 });
      }
      if (!eligibility!.eligible) {
        return NextResponse.json(
          { error: 'That original post has been used too recently to copy' },
          { status: 400 },
        );
      }
      if (!original) {
        return NextResponse.json(
          { error: 'That account is not in the account database, so this post can’t be recorded as a copy.' },
          { status: 404 },
        );
      }
      // Only a listed Viral Account may be copied from. An admin un-ticking
      // `isViralBonus` retires the page immediately — the client shows the same
      // message, but this is the enforcement.
      if (!original.isViralBonus) {
        return NextResponse.json(
          { error: 'The selected account is not a viral account you may copy posts from. Please only use accounts from Viral Accounts. If you think this is a mistake, contact your team leader.' },
          { status: 400 },
        );
      }
      source = { id: original.id, name: original.name };
    }

    const ref = adminDb
      .collection(SMM_SCHEDULE).doc(body.accountId).collection(SMM_POSTS_SUB).doc();
    await ref.set({
      caption: body.caption ?? '',
      accountName: account.accountName ?? '',
      postDate: Timestamp.fromDate(postDate),
      postLink,
      postLinkNormalized: postNormalized,
      postedBy: token.uid,
      createdTime: FieldValue.serverTimestamp(),
      bonusSubmission: false,
      isViralCopy: !!originalLink,
      originalLink,
      originalLinkNormalized: originalNormalized,
      originalAcc: source.id,
      sourceAcc: source.id,
      sourceAccName: source.name,
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (error) {
    console.error('[POST /api/smm/posts]', error);
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
  }
});
