/**
 * An employee's own Telegram invite — the self-service half of linking.
 *
 * POST mints a one-time link for **the caller's own uid**, taken from the
 * verified token and never from the body. There is no `uid` parameter on
 * purpose: a route that accepted one would let any signed-in user mint a link
 * that binds their Telegram account to a colleague's identity, which is an
 * account takeover with extra steps. Admin-issued links exist only for
 * creators, who have no way to ask for one themselves.
 *
 * DELETE disconnects. For an employee this is a preference, not a lockout —
 * they sign in with Google, so unlinking only stops Telegram delivery. That is
 * exactly what the linking message means by "can be disabled in Bluu Backend
 * settings".
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import {
  mintTelegramLinkToken,
  unlinkTelegramAccount,
} from '@/lib/services/telegramLinkService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const { url, expiresAt } = await mintTelegramLinkToken({
      subjectKind: 'user',
      subjectUid: token.uid,
      createdBy: token.uid,
    });
    return NextResponse.json({ url, expiresAt: expiresAt.toISOString() });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'SUBJECT_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    console.error('[POST /api/user/telegram-link]', error);
    return NextResponse.json({ error: 'Failed to generate link' }, { status: 500 });
  }
});

export const DELETE = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const { unlinked } = await unlinkTelegramAccount('user', token.uid);
    return NextResponse.json({ success: true, unlinked });
  } catch (error: unknown) {
    console.error('[DELETE /api/user/telegram-link]', error);
    return NextResponse.json({ error: 'Failed to disconnect Telegram' }, { status: 500 });
  }
});
