import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { clearUnread, requireOnlyFansAccess } from '@/lib/services/onlyfansService';
import { OnlyFansApiError, getOnlyFansClient, resolveAccountId } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

type Params = { chatId: string };

/**
 * POST /api/onlyfans/chats/[chatId]/read — mark a thread read.
 *
 * Fired once when a thread with unread messages is opened, never on every
 * render: it costs a provider call. The mirror's badge is cleared only after
 * the provider accepts, so the list never lies about OnlyFans' own state.
 */
export const POST = withAuth<Params>(
  async (_request: NextRequest, token: DecodedIdToken, params: Promise<Params>) => {
    const denied = await requireOnlyFansAccess(token.uid);
    if (denied) return denied;

    const { chatId } = await params;
    if (!/^[0-9]{1,32}$/.test(chatId)) {
      return NextResponse.json({ error: 'Invalid chat id' }, { status: 400 });
    }

    try {
      const accountId = await resolveAccountId();
      await getOnlyFansClient().markChatRead(accountId, chatId);
      await clearUnread(accountId, chatId);
      return NextResponse.json({ ok: true });
    } catch (error) {
      if (error instanceof OnlyFansApiError) {
        return handleApiError(
          error,
          'POST /api/onlyfans/chats/[chatId]/read',
          error.status >= 500 ? 502 : error.status,
        );
      }
      return handleApiError(error, 'POST /api/onlyfans/chats/[chatId]/read');
    }
  },
);
