import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkSmmAccess, findDuplicatePostLink } from '@/lib/services/smmService';
import { normalizePostLink } from '@/lib/smm/linkUtils';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/posts/check-link?link=URL[&excludeAccountId=&excludePostId=]
 *
 * "Has this post already been recorded?" — the live check behind the Post link
 * field while scheduling or editing a post. Deliberately the cheapest question
 * we can ask: one collection-group equality on `postLinkNormalized`, keys only,
 * capped at two docs. It answers a boolean, nothing more, so it never resolves
 * user names or serializes documents the way the eligibility route does.
 *
 * Advisory only — POST/PATCH /api/smm/posts re-run the same check before
 * writing.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'either');
    if (denied) return denied;

    const params = request.nextUrl.searchParams;
    const normalized = normalizePostLink(params.get('link') ?? '');
    if (!normalized) {
      return NextResponse.json({ error: 'A link is required' }, { status: 400 });
    }

    const duplicate = await findDuplicatePostLink(normalized, {
      accountId: params.get('excludeAccountId') ?? undefined,
      postId: params.get('excludePostId') ?? undefined,
    });

    return NextResponse.json({ duplicate });
  } catch (error) {
    console.error('[GET /api/smm/posts/check-link]', error);
    return NextResponse.json({ error: 'Failed to check the post link' }, { status: 500 });
  }
});
