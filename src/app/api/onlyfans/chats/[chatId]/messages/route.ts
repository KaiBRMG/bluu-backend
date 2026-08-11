import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  recordLiveMessage,
  requireOnlyFansAccess,
} from '@/lib/services/onlyfansService';
import { OnlyFansApiError, getOnlyFansClient, resolveAccountId } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

type Params = { chatId: string };

/** Provider chat ids are numeric OnlyFans user ids. Reject anything else. */
function parseChatId(chatId: string): string | null {
  return /^[0-9]{1,32}$/.test(chatId) ? chatId : null;
}

function providerError(error: unknown, context: string): NextResponse {
  if (error instanceof OnlyFansApiError) {
    return handleApiError(error, context, error.status >= 500 ? 502 : error.status);
  }
  return handleApiError(error, context);
}

/**
 * GET /api/onlyfans/chats/[chatId]/messages — one page of history, newest first.
 *
 * History is **not** mirrored into Firestore (thousands of writes per thread for
 * data that is read once), so it is paged straight from the provider and cached
 * client-side. `?cursor=` is the opaque token from the previous page and drives
 * the lazy "scroll up for older messages" load.
 */
export const GET = withAuth<Params>(
  async (request: NextRequest, token: DecodedIdToken, params: Promise<Params>) => {
    const denied = await requireOnlyFansAccess(token.uid);
    if (denied) return denied;

    const chatId = parseChatId((await params).chatId);
    if (!chatId) return NextResponse.json({ error: 'Invalid chat id' }, { status: 400 });

    try {
      const search = request.nextUrl.searchParams;
      const limitParam = Number(search.get('limit'));
      const accountId = await resolveAccountId();
      const page = await getOnlyFansClient().listMessages(accountId, chatId, {
        limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 30,
        cursor: search.get('cursor') ?? undefined,
      });
      return NextResponse.json(page);
    } catch (error) {
      return providerError(error, 'GET /api/onlyfans/chats/[chatId]/messages');
    }
  },
);

/** Max characters accepted in one message. Guards the provider and our UI alike. */
const MAX_TEXT_LENGTH = 5000;

/**
 * POST /api/onlyfans/chats/[chatId]/messages — send a message.
 *
 * On success the sent message is written to the live-message subcollection so
 * every operator with the thread open sees it immediately, without waiting for
 * the `messages.sent` webhook (which lands on the same doc id and is therefore
 * idempotent).
 */
export const POST = withAuth<Params>(
  async (request: NextRequest, token: DecodedIdToken, params: Promise<Params>) => {
    const denied = await requireOnlyFansAccess(token.uid);
    if (denied) return denied;

    const chatId = parseChatId((await params).chatId);
    if (!chatId) return NextResponse.json({ error: 'Invalid chat id' }, { status: 400 });

    const body = await request.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return NextResponse.json({ error: 'Message text is required' }, { status: 400 });
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: `Message exceeds ${MAX_TEXT_LENGTH} characters` }, { status: 400 });
    }

    try {
      const accountId = await resolveAccountId();
      const message = await getOnlyFansClient().sendMessage(accountId, chatId, { text });

      // Sending is also an implicit read of the thread.
      await recordLiveMessage(accountId, message, { unread: 'reset' });

      return NextResponse.json({ message });
    } catch (error) {
      return providerError(error, 'POST /api/onlyfans/chats/[chatId]/messages');
    }
  },
);
