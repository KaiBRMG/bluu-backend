import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireOnlyFansAccess } from '@/lib/services/onlyfansService';
import { OnlyFansApiError, resolveAccountId } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/onlyfans/account — which account this window operates.
 *
 * Exists purely for **time to first paint**. `GET /api/onlyfans/chats` also
 * returns the account id, but only after it has synced the mirror: a provider
 * `listChats` plus a batched Firestore read and write, seconds on a cold start.
 * The chat list cannot attach its `onSnapshot` until it knows the account, so
 * without this route the whole inbox waits on work it does not need.
 *
 * This is nearly free — `ONLYFANS_ACCOUNT_ID` answers it from the environment,
 * and without it `resolveAccountId` is memoised for an hour per instance. The
 * client calls it in parallel with the sync and renders as soon as it lands.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;

  try {
    return NextResponse.json({ accountId: await resolveAccountId() });
  } catch (error) {
    if (error instanceof OnlyFansApiError) {
      return handleApiError(
        error,
        'GET /api/onlyfans/account',
        error.status >= 500 ? 502 : error.status,
      );
    }
    return handleApiError(error, 'GET /api/onlyfans/account');
  }
});
