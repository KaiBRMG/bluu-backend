/**
 * The Telegram bot webhook — the only unauthenticated *write* path in the app
 * besides the public model-application form, and the one that decides account
 * identity. Treat every field of the body as attacker-controlled.
 *
 * ── What stands between the internet and account linking ─────────────────────
 *
 *  1. **The secret header.** Telegram sends `X-Telegram-Bot-Api-Secret-Token` on
 *     every delivery, set once at `setWebhook` time. It is compared in constant
 *     time against `TELEGRAM_WEBHOOK_SECRET`; a mismatch is a flat 401 with no
 *     body. Without this, anyone who learns the URL can post a synthetic
 *     `/start <token>` and bind *their own* Telegram id to someone else's
 *     account — the update body is the only thing naming the Telegram user.
 *     **If the env var is unset the route refuses everything**, rather than
 *     falling open, because "misconfigured" and "unauthenticated" are the same
 *     risk here.
 *
 *  2. **The token itself.** 256 bits, single-use, hashed at rest, and only ever
 *     minted by an authenticated surface (an admin on Creator Management, or a
 *     user for their own uid). Guessing is not a threat model; replay and
 *     staleness are, and `consumeTelegramLinkToken` closes both.
 *
 *  3. **A per-sender rate limit**, so a flood of `/start` guesses cannot spend
 *     Firestore reads indefinitely. In-process, therefore per-lambda and
 *     best-effort — same shape and same caveat as `exchange-code`'s limiter.
 *
 * ── Why it always answers 200 ────────────────────────────────────────────────
 *
 * Past the secret check, every outcome is a 200. Telegram retries a non-2xx
 * delivery with backoff and will eventually disable a webhook that keeps
 * failing, so a bad token — an *expected* input — must not look like an outage.
 * The user is told what went wrong in the chat instead, which is the only place
 * they can see it.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { consumeTelegramLinkToken } from '@/lib/services/telegramLinkService';
import {
  isTelegramConfigured,
  sendTelegramMessage,
  setCreatorPortalMenuButton,
  escapeHtml,
} from '@/lib/services/telegramService';
import { telegramMessages } from '@/lib/notificationContent';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';

/** Telegram never sends a body this large for the updates we handle. */
const MAX_BODY_BYTES = 64 * 1024;

/** Per-Telegram-user `/start` attempts allowed per window. */
const RATE_LIMIT = 10;
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

/** Constant-time compare that does not leak length through an early return. */
function secretMatches(provided: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number | string; username?: string; first_name?: string; is_bot?: boolean };
  };
}

export async function POST(request: NextRequest) {
  if (!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'))) {
    return new NextResponse(null, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: true });
    update = JSON.parse(raw) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  const from = message?.from;
  const chat = message?.chat;

  // Only private chats with a real human. A bot echo, a channel post, or the bot
  // being added to a group are all updates we have no behaviour for — and a
  // group chat id must never end up bound to a personal account.
  if (!message || !from?.id || !chat?.id || from.is_bot || chat.type !== 'private') {
    return NextResponse.json({ ok: true });
  }

  const telegramUserId = String(from.id);
  const chatId = String(chat.id);

  if (rateLimited(telegramUserId)) return NextResponse.json({ ok: true });

  const text = (message.text ?? '').trim();
  if (!text.startsWith('/start')) return NextResponse.json({ ok: true });

  // `/start` → the payload is everything after the command. Telegram restricts
  // it to [A-Za-z0-9_-]{1,64}; anything else was not produced by us.
  const payload = text.slice('/start'.length).trim();
  if (!payload) {
    await sendTelegramMessage(chatId, telegramMessages.startWithoutToken());
    return NextResponse.json({ ok: true });
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(payload)) {
    await sendTelegramMessage(chatId, telegramMessages.linkInvalid());
    return NextResponse.json({ ok: true });
  }

  // Without a bot token nothing can be replied to anyway, and binding an account
  // the user is never told about is worse than doing nothing.
  if (!isTelegramConfigured()) {
    console.error('[telegram/webhook] TELEGRAM_BOT_TOKEN is not configured');
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await consumeTelegramLinkToken(payload, {
      userId: telegramUserId,
      chatId,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
    });

    switch (result.status) {
      case 'invalid':
        await sendTelegramMessage(chatId, telegramMessages.linkInvalid());
        break;
      case 'conflict':
        await sendTelegramMessage(chatId, telegramMessages.linkConflict());
        break;
      case 'inactive':
        await sendTelegramMessage(chatId, telegramMessages.linkInactive());
        break;
      case 'linked': {
        if (result.subjectKind === 'creator') {
          // The message ends by pointing at the menu button, so install the
          // button first — otherwise the arrow points at nothing for whatever
          // time the second call takes.
          // `/creator/dashboard`, NOT `/creator` — the latter 307s, and
          // Telegram launches the webview with the signed payload in a URL
          // *fragment*, which in-app webviews do not reliably re-attach across a
          // redirect. One hop, one chance to lose the whole session. Point
          // straight at the destination.
          await setCreatorPortalMenuButton(chatId, `${PUBLIC_APP_ORIGIN}/creator/dashboard`);
          await sendTelegramMessage(
            chatId,
            telegramMessages.creatorWelcome(escapeHtml(result.displayName)),
          );
        } else {
          await sendTelegramMessage(chatId, telegramMessages.employeeWelcome());
        }
        break;
      }
    }
  } catch (error: unknown) {
    // A thrown error here means the binding transaction failed, so nothing was
    // written and the token is still live — the user can click the same link
    // again. Log it; still answer 200 so Telegram does not disable the webhook.
    console.error('[telegram/webhook] link failed:', error);
    await sendTelegramMessage(chatId, telegramMessages.linkInvalid());
  }

  return NextResponse.json({ ok: true });
}
