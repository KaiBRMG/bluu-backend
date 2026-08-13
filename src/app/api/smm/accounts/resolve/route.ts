import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkSmmAccess, findAccountByHandle } from '@/lib/services/smmService';
import { extractAccountHandle } from '@/lib/smm/linkUtils';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/accounts/resolve?link=URL
 *
 * "Whose account is this link on?" — the fallback behind the Post link field in
 * {@link CreatePostDialog}. The dialog resolves the handle against the caller's
 * own accounts locally (it already holds them); this route is asked **only when
 * that fails**, purely to tell the three failure modes apart: the handle is not
 * in `twitterx-accounts` at all, it is there but assigned to someone else, or
 * it is inactive. Without it every miss would read "not in the database", which
 * is wrong for an account the caller simply hasn't been assigned.
 *
 * One `in` query on `accountName`, capped at one doc ({@link findAccountByHandle}).
 * It answers with the account's own public-ish facts — name, status, and
 * whether it is the caller's — and **never** the `assigned` uid.
 *
 * Advisory only: `POST /api/smm/posts` re-checks ownership (`assertAccountWritable`)
 * and the handle match before writing.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'either');
    if (denied) return denied;

    const handle = extractAccountHandle(request.nextUrl.searchParams.get('link') ?? '');
    if (!handle) {
      return NextResponse.json({ error: 'A Twitter/X link is required' }, { status: 400 });
    }

    const doc = await findAccountByHandle(handle);
    if (!doc) return NextResponse.json({ exists: false });

    const account = doc.data() ?? {};
    return NextResponse.json({
      exists: true,
      accountName: (account.accountName as string) ?? '',
      active: account.status === 'active',
      mine: account.assigned === token.uid,
    });
  } catch (error) {
    console.error('[GET /api/smm/accounts/resolve]', error);
    return NextResponse.json({ error: 'Failed to resolve the account' }, { status: 500 });
  }
});
