import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireOnlyFansAccess, syncChats } from '@/lib/services/onlyfansService';
import { OnlyFansApiError } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/onlyfans/chats — refresh the Firestore chat mirror.
 *
 * Deliberately returns **no chat payload**: the client reads the mirror via
 * `onSnapshot`, which is both realtime (webhook writes land instantly) and
 * cheaper than shipping the same rows twice. This route exists only to make
 * sure the mirror is warm, and it is rate limited inside `syncChats`.
 *
 *   ?refresh=1        bypass the sync TTL (explicit user refresh only)
 *   ?limit=<1-100>    how many chats to pull from the provider
 *   ?offset=<n>       load older chats (always a real pull; widens the mirror)
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;

  try {
    const params = request.nextUrl.searchParams;
    const limitParam = Number(params.get('limit'));
    const offsetParam = Number(params.get('offset'));
    const result = await syncChats({
      force: params.get('refresh') === '1',
      limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : undefined,
      offset: Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OnlyFansApiError) {
      return handleApiError(error, 'GET /api/onlyfans/chats', error.status >= 500 ? 502 : 400);
    }
    return handleApiError(error, 'GET /api/onlyfans/chats');
  }
});
