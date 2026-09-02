/**
 * Telegram delivery for notifications.
 *
 * SERVER ONLY — reads `TELEGRAM_BOT_TOKEN`, which must never reach the client.
 *
 * This is the Telegram half of the notification system. It does not replace the
 * in-app notification: a Telegram-flagged send writes the same Firestore docs as
 * a normal one and then *additionally* pushes to Telegram. Copy still comes from
 * the caller (for admin broadcasts, the title/message the admin typed) — this
 * file owns delivery and formatting only, never wording.
 *
 * ── Recipient resolution (temporary) ─────────────────────────────────────────
 * No user has linked a Telegram account yet, so there is nothing on the user doc
 * to look up. Until that pass lands, every Telegram notification goes to the
 * single test chat in `TG_BOT_TEST_ID`, once per send (not once per recipient) —
 * see `resolveChatIds`. Doing it this way costs zero extra Firestore reads
 * (cross-cutting rule 9) and keeps the call sites unchanged when real linking
 * arrives: only `resolveChatIds` has to learn about `users/{uid}.telegramChatId`.
 */

import { classifyNotificationAction } from '@/lib/notificationActionUrl';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export interface TelegramMessagePayload {
  title: string;
  message: string;
  /** App path or external URL. Only external ones are linked — see `resolveLink`. */
  actionUrl?: string | null;
}

export interface TelegramSendResult {
  /** Number of chats the message reached. */
  sent: number;
  /** Number of chats that failed. */
  failed: number;
  /** True when Telegram was skipped entirely because it is not configured. */
  skipped: boolean;
  /** First failure reason, for logging/surfacing. */
  error?: string;
}

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

function fallbackChatId(): string | null {
  return process.env.TG_BOT_TEST_ID?.trim() || null;
}

/** True when the bot token is present. Without it nothing can be delivered. */
export function isTelegramConfigured(): boolean {
  return botToken() !== null;
}

/**
 * Chat ids to deliver to for a set of recipient uids.
 *
 * TEMPORARY: uids are ignored — everything lands in the test chat, deduplicated
 * to one message per send. Replace the body (not the signature) when users can
 * link their Telegram accounts.
 */
export function resolveChatIds(_recipientUids: string[]): string[] {
  const fallback = fallbackChatId();
  return fallback ? [fallback] : [];
}

/** Telegram HTML parse mode only requires these three to be escaped. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The link to put in the message, or null for none.
 *
 * Only external URLs are linked. An internal app path is deliberately
 * dropped: `src/middleware.ts` rewrites non-Electron page traffic to
 * `/desktop-only`, so a link to an in-app page opened from a phone is a dead end.
 * The in-app notification carries that action; Telegram just announces it.
 */
function resolveLink(actionUrl?: string | null): string | null {
  const target = classifyNotificationAction(actionUrl);
  return target.kind === 'external' ? target.href : null;
}

function buildMessageHtml({ title, message, actionUrl }: TelegramMessagePayload): string {
  const parts = [`<b>${escapeHtml(title)}</b>`, escapeHtml(message)];
  const link = resolveLink(actionUrl);
  if (link) parts.push(`<a href="${escapeHtml(link)}">Open link</a>`);
  return parts.join('\n\n');
}

/** Sends one message to one chat. Resolves false on any failure (never throws). */
async function sendToChat(chatId: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const token = botToken();
  if (!token) return { ok: false, error: 'Telegram bot token not configured' };

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      // Never log the token; `description` is Telegram's own error string.
      const description = data?.description ?? `HTTP ${res.status}`;
      return { ok: false, error: String(description) };
    }
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : 'Telegram request failed' };
  }
}

/**
 * Delivers a notification to Telegram for the given recipients.
 *
 * Never throws — Telegram is a secondary channel and must not fail a request
 * whose Firestore writes already succeeded. Inspect the result instead.
 */
export async function sendTelegramNotification(
  recipientUids: string[],
  payload: TelegramMessagePayload
): Promise<TelegramSendResult> {
  if (!isTelegramConfigured()) {
    return { sent: 0, failed: 0, skipped: true, error: 'Telegram bot token not configured' };
  }

  const chatIds = resolveChatIds(recipientUids);
  if (chatIds.length === 0) {
    return { sent: 0, failed: 0, skipped: true, error: 'No Telegram recipients configured' };
  }

  const html = buildMessageHtml(payload);
  const results = await Promise.all(chatIds.map(chatId => sendToChat(chatId, html)));

  const failures = results.filter(r => !r.ok);
  return {
    sent: results.length - failures.length,
    failed: failures.length,
    skipped: false,
    error: failures[0]?.error,
  };
}
