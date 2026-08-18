import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireOnlyFansAccess, setMessageFlag } from '@/lib/services/onlyfansService';
import { OnlyFansApiError, resolveAccountId } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * The shared body of the two per-message flag routes (`…/pin`, `…/like`).
 *
 * Both are the same route four times over — POST to set, DELETE to clear, on two
 * flags — so the authorization, the id validation and the provider-error mapping
 * live here once. Splitting them into two `route.ts` files is what makes the
 * verbs match the provider's own surface; splitting the *logic* would just be
 * two copies of the same twenty lines drifting apart.
 *
 * `_lib` is a private folder: Next never routes it.
 */

type Params = { chatId: string; messageId: string };

/** Provider chat ids are numeric OnlyFans user ids; message ids likewise. */
const NUMERIC_ID = /^[0-9]{1,32}$/;

export function messageFlagHandler(flag: 'pinned' | 'liked', value: boolean) {
  return withAuth<Params>(
    async (_request: NextRequest, token: DecodedIdToken, params: Promise<Params>) => {
      const denied = await requireOnlyFansAccess(token.uid);
      if (denied) return denied;

      const { chatId, messageId } = await params;
      if (!NUMERIC_ID.test(chatId) || !NUMERIC_ID.test(messageId)) {
        return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
      }

      const context = `${value ? '' : 'un'}${flag === 'pinned' ? 'pin' : 'like'} message`;

      try {
        const accountId = await resolveAccountId();
        await setMessageFlag(accountId, chatId, messageId, flag, value);
        return NextResponse.json({ ok: true, [flag]: value });
      } catch (error) {
        if (error instanceof OnlyFansApiError) {
          return handleApiError(error, context, error.status >= 500 ? 502 : error.status);
        }
        return handleApiError(error, context);
      }
    },
  );
}
