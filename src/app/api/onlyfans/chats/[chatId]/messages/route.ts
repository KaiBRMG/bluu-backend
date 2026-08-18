import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  listMessagePage,
  recordLiveMessage,
  requireOnlyFansAccess,
} from '@/lib/services/onlyfansService';
import { reportUnrecognisedVideoSourceHost } from '@/lib/services/onlyfansOpsAlerts';
import { OnlyFansApiError, getOnlyFansClient, resolveAccountId } from '@/lib/onlyfans';
import {
  MAX_MESSAGE_MEDIA,
  MAX_PPV_PRICE,
  MIN_PPV_PRICE,
  isValidPpvPrice,
} from '@/lib/onlyfansUpload';
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
      const page = await listMessagePage(accountId, chatId, {
        limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 30,
        cursor: search.get('cursor') ?? undefined,
        // Only ever set by the explicit refresh button.
        force: search.get('refresh') === '1',
      });

      // Normalising that page may have found the provider serving its video
      // renditions from a host we reject — which silently switches off the
      // largest media saving in the app. `after()` so the check never sits in
      // front of the operator's thread; it is a no-op on all but the first
      // sighting in a given lambda, and does nothing at all once alerted.
      after(reportUnrecognisedVideoSourceHost);

      return NextResponse.json(page);
    } catch (error) {
      return providerError(error, 'GET /api/onlyfans/chats/[chatId]/messages');
    }
  },
);

/** Max characters accepted in one message. Guards the provider and our UI alike. */
const MAX_TEXT_LENGTH = 5000;

/**
 * A media id is either a staged upload (`ofapi_media_…`) or a numeric OnlyFans
 * vault id. Both are forwarded verbatim into a provider payload, so the shape is
 * checked here rather than assumed.
 */
const MEDIA_ID = /^(ofapi_media_[A-Za-z0-9]{1,64}|[0-9]{1,32})$/;

function parseMediaIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_MESSAGE_MEDIA) return null;
  if (!value.every((id: unknown) => typeof id === 'string' && MEDIA_ID.test(id))) return null;
  return [...new Set(value as string[])];
}

/**
 * POST /api/onlyfans/chats/[chatId]/messages — send a message.
 *
 * Carries text, attachments (staged uploads and vault media alike), and a PPV
 * price with its preview set. On success the sent message is written to the
 * live-message subcollection so every operator with the thread open sees it
 * immediately, without waiting for the `messages.sent` webhook (which lands on
 * the same doc id and is therefore idempotent).
 */
export const POST = withAuth<Params>(
  async (request: NextRequest, token: DecodedIdToken, params: Promise<Params>) => {
    const denied = await requireOnlyFansAccess(token.uid);
    if (denied) return denied;

    const chatId = parseChatId((await params).chatId);
    if (!chatId) return NextResponse.json({ error: 'Invalid chat id' }, { status: 400 });

    const body = await request.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: `Message exceeds ${MAX_TEXT_LENGTH} characters` }, { status: 400 });
    }

    const mediaIds = parseMediaIds(body?.mediaIds);
    const previewIds = parseMediaIds(body?.previewIds);
    if (!mediaIds || !previewIds) {
      return NextResponse.json({ error: 'Invalid attachments' }, { status: 400 });
    }

    // Text is only required when there is nothing else to send — a bare photo is
    // an ordinary message on this surface.
    if (!text && mediaIds.length === 0) {
      return NextResponse.json({ error: 'Message text is required' }, { status: 400 });
    }

    const price = body?.price === undefined || body?.price === null ? 0 : Number(body.price);
    if (!isValidPpvPrice(price)) {
      return NextResponse.json(
        { error: `Price must be 0, or between $${MIN_PPV_PRICE} and $${MAX_PPV_PRICE}` },
        { status: 400 },
      );
    }
    // The provider rejects a priced message with nothing to unlock, and a
    // preview that is not part of the set it is previewing.
    if (price > 0 && mediaIds.length === 0) {
      return NextResponse.json({ error: 'A paid message needs media' }, { status: 400 });
    }
    if (!previewIds.every((id) => mediaIds.includes(id))) {
      return NextResponse.json({ error: 'Previews must be part of the attached media' }, { status: 400 });
    }

    // A reply target is a message id and goes into a provider payload verbatim,
    // so it is shape-checked here rather than assumed. Absent is the norm.
    const replyToRaw = body?.replyToMessageId;
    const replyToMessageId =
      replyToRaw === undefined || replyToRaw === null ? undefined : String(replyToRaw);
    if (replyToMessageId !== undefined && !/^[0-9]{1,32}$/.test(replyToMessageId)) {
      return NextResponse.json({ error: 'Invalid reply target' }, { status: 400 });
    }

    try {
      const accountId = await resolveAccountId();
      const message = await getOnlyFansClient().sendMessage(accountId, chatId, {
        text,
        replyToMessageId,
        mediaIds,
        previewIds: price > 0 ? previewIds : undefined,
        price,
        lockedText: price > 0 && body?.lockedText === true,
      });

      // Sending is also an implicit read of the thread.
      await recordLiveMessage(accountId, message, { unread: 'reset' });

      return NextResponse.json({ message });
    } catch (error) {
      return providerError(error, 'POST /api/onlyfans/chats/[chatId]/messages');
    }
  },
);
