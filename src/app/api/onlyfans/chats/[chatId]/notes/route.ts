import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getFanNotesCached, requireOnlyFansAccess } from '@/lib/services/onlyfansService';
import { OnlyFansApiError, resolveAccountId } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

type Params = { chatId: string };

/**
 * GET /api/onlyfans/chats/[chatId]/notes — the creator's private note on a fan.
 *
 * **The one billed part of the fan panel.** Everything else the panel shows
 * arrives free on the chat list and is read from the Firestore mirror; a note is
 * its own provider call per fan, so it is fetched only when the operator asks
 * for it and memoised for fifteen minutes behind that.
 *
 * A chat id *is* the fan's OnlyFans user id, which is why no separate fan id is
 * needed here.
 *
 * Read-only. Writing a note is a real-world action on a creator's account and
 * belongs behind Phase 9's audit log, not behind a textarea in a panel.
 */
export const GET = withAuth<Params>(
  async (_request: NextRequest, token: DecodedIdToken, params: Promise<Params>) => {
    const denied = await requireOnlyFansAccess(token.uid);
    if (denied) return denied;

    const { chatId } = await params;
    if (!/^[0-9]{1,32}$/.test(chatId)) {
      return NextResponse.json({ error: 'Invalid chat id' }, { status: 400 });
    }

    try {
      const accountId = await resolveAccountId();
      const notes = await getFanNotesCached(accountId, chatId);
      return NextResponse.json({ notes });
    } catch (error) {
      const context = 'GET /api/onlyfans/chats/[chatId]/notes';
      if (error instanceof OnlyFansApiError) {
        return handleApiError(error, context, error.status >= 500 ? 502 : error.status);
      }
      return handleApiError(error, context);
    }
  },
);
