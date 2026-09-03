/**
 * The creator portal's sign-in.
 *
 * This route **is** the authentication for the creator portal — there is no
 * password path any more. It takes the `initData` blob Telegram hands the Mini
 * App's webview, verifies its HMAC against the bot token, resolves the Telegram
 * user to a creator through the link index, and mints a Firebase custom token.
 *
 * Deliberately unauthenticated (`withCreatorAuth` guards routes *after* this
 * one), and therefore hardened like the other public entry points:
 *
 * ▸ **`verifyTelegramInitData` is the whole gate.** Nothing in the body is
 *   trusted before it returns; the `user.id` it yields is the only identity
 *   claim accepted, and the client never says which creator it is.
 *
 * ▸ **The binding, not the Telegram profile, decides who this is.**
 *   `lookupTelegramSubject` re-reads the creator doc, so a deactivated or
 *   archived creator resolves to nothing even though their index entry survives.
 *
 * ▸ **Rate limited per Telegram id.** A verified-but-unlinked caller costs two
 *   Firestore reads; an unverified one costs an HMAC. Neither should be free to
 *   repeat without bound.
 *
 * ▸ **Failures are distinguishable on purpose here**, unlike the login
 *   allowlist. The audience is a creator who has been handed a link and cannot
 *   get in; "you have not connected yet" and "this is a staff account" are the
 *   two things they need told, and neither enumerates anyone — the caller has
 *   already proven ownership of the Telegram account being described.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { verifyTelegramInitData } from '@/lib/services/telegramService';
import { lookupTelegramSubject } from '@/lib/services/telegramLinkService';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

export async function POST(request: NextRequest) {
  let initData: unknown;
  try {
    ({ initData } = (await request.json()) as { initData?: unknown });
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 8192) {
    return NextResponse.json({ error: 'INVALID_INIT_DATA' }, { status: 401 });
  }

  const telegramUser = verifyTelegramInitData(initData);
  if (!telegramUser) {
    return NextResponse.json({ error: 'INVALID_INIT_DATA' }, { status: 401 });
  }

  if (rateLimited(telegramUser.id)) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  }

  const subject = await lookupTelegramSubject(telegramUser.id);
  if (!subject) {
    return NextResponse.json({ error: 'NOT_LINKED' }, { status: 403 });
  }
  if (subject.subjectKind !== 'creator') {
    return NextResponse.json({ error: 'NOT_A_CREATOR' }, { status: 403 });
  }

  try {
    const customToken = await adminAuth.createCustomToken(subject.subjectUid);
    return NextResponse.json({ customToken });
  } catch (error: unknown) {
    console.error('[creator/telegram/session] custom token failed:', error);
    return NextResponse.json({ error: 'SESSION_FAILED' }, { status: 500 });
  }
}
