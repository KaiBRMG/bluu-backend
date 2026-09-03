/**
 * Telegram Bot API delivery.
 *
 * SERVER ONLY — reads `TELEGRAM_BOT_TOKEN`, which must never reach the client.
 * Nothing in `src/components` or `src/hooks` may import this file. The public
 * names a component needs (the bot username, the Mini App link) live in
 * `lib/telegramConfig.ts` instead.
 *
 * This file owns **delivery and formatting only, never wording** — notification
 * copy lives in `notificationContent.ts` and nowhere else (notifications.md
 * rule 1), including the two bot messages sent at account linking.
 *
 * ── Recipient resolution ─────────────────────────────────────────────────────
 * `resolveChatIds` maps recipient uids onto the chat ids on their user docs, in
 * a single batched `getAll` with a field mask — one read per recipient, no N+1,
 * and only the one field comes back (cross-cutting rule 9). Users who have not
 * linked Telegram simply drop out; that is the opt-out, and it is why
 * "Disconnect" in App Settings genuinely stops delivery rather than just
 * hiding a badge.
 *
 * There is deliberately **no `TG_BOT_TEST_ID` fallback any more.** It existed
 * while nobody had linked an account, and it sent every Telegram-flagged
 * broadcast to one test chat. Keeping it now would mean a send whose real
 * recipients happen to be unlinked lands in that chat instead of nowhere —
 * misdelivery dressed up as success. An unresolvable send is `skipped`.
 */

import crypto from 'crypto';
import { classifyNotificationAction } from '@/lib/notificationActionUrl';
import { adminDb } from '@/lib/firebase-admin';

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

/** True when the bot token is present. Without it nothing can be delivered. */
export function isTelegramConfigured(): boolean {
  return botToken() !== null;
}

/**
 * One call to the Bot API. Never throws — every caller here is on a path where a
 * Telegram failure must not fail the request (a webhook that has already bound
 * an account, a notification already written to Firestore).
 *
 * The bot token is in the URL, so it must never appear in a log line: only
 * Telegram's own `description` and the HTTP status are surfaced.
 */
export async function callTelegram(
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const token = botToken();
  if (!token) return { ok: false, error: 'Telegram bot token not configured' };

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const description = data?.description ?? `HTTP ${res.status}`;
      return { ok: false, error: String(description) };
    }
    return { ok: true, result: data.result };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : 'Telegram request failed' };
  }
}

/**
 * Chat ids to deliver to for a set of recipient uids.
 *
 * Employees only: recipients of an in-app notification are `users` uids by
 * definition. Creators are addressed through their own chat id on the `creators`
 * doc, by whatever sends to them — this function is not the place to guess which
 * collection a uid belongs to.
 */
export async function resolveChatIds(recipientUids: string[]): Promise<string[]> {
  const uids = [...new Set(recipientUids.filter(Boolean))];
  if (uids.length === 0) return [];

  const refs = uids.map((uid) => adminDb.collection('users').doc(uid));
  // Field-masked so a fan-out to the whole company does not pull whole user docs
  // back for one string each.
  const snaps = await adminDb.getAll(...refs, { fieldMask: ['telegram.chatId'] });

  const chatIds = new Set<string>();
  for (const snap of snaps) {
    const chatId: unknown = snap.get('telegram.chatId');
    if (typeof chatId === 'string' && chatId) chatIds.add(chatId);
  }
  return [...chatIds];
}

/** Telegram HTML parse mode only requires these three to be escaped. */
export function escapeHtml(text: string): string {
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

/**
 * Sends pre-formatted HTML to one chat.
 *
 * `html` is trusted to be well-formed Telegram HTML: callers that interpolate
 * anything user-supplied must run it through `escapeHtml` first. Resolves false
 * on any failure; never throws.
 */
export async function sendTelegramMessage(
  chatId: string,
  html: string,
  options?: { replyMarkup?: Record<string, unknown> },
): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  };
  if (options?.replyMarkup) payload.reply_markup = options.replyMarkup;

  const res = await callTelegram('sendMessage', payload);
  return { ok: res.ok, error: res.error };
}

/**
 * Point a single chat's menu button at the creator portal Mini App.
 *
 * Per-chat rather than global: the same bot serves employees, for whom a
 * "Creator Portal" button is meaningless. Telegram rejects a `web_app` URL whose
 * domain has not been registered for the bot in BotFather — that domain must be
 * `PUBLIC_APP_ORIGIN`, not the vercel.app host the Electron shell is pinned to.
 */
export async function setCreatorPortalMenuButton(
  chatId: string,
  webAppUrl: string,
  label = 'Creator Portal',
): Promise<{ ok: boolean; error?: string }> {
  const res = await callTelegram('setChatMenuButton', {
    chat_id: chatId,
    menu_button: { type: 'web_app', text: label, web_app: { url: webAppUrl } },
  });
  return { ok: res.ok, error: res.error };
}

/**
 * ── Mini App `initData` verification ─────────────────────────────────────────
 *
 * The creator portal's entire authentication rests on this function. Telegram
 * hands the webview a query-string blob and an HMAC over it, keyed by the bot
 * token; verifying that HMAC is what proves the caller is really inside Telegram
 * as the user they claim to be. **Everything in `initData` is attacker-supplied
 * until this returns non-null** — including `user.id`, which is the identity the
 * session is minted against.
 *
 * The scheme (from core.telegram.org/bots/webapps): build a newline-joined,
 * key-sorted `k=v` string of every field except `hash`, then compare
 * `HMAC(HMAC("WebAppData", bot_token), data_check_string)`. Note the two-level
 * keying — the *secret* is itself an HMAC of the token, not the token.
 *
 * `auth_date` is checked because the HMAC alone never expires: a blob captured
 * once would otherwise mint sessions forever. The window is generous
 * (`MAX_INIT_DATA_AGE_MS`) because Telegram issues `initData` at launch and does
 * not refresh it while the Mini App stays open — too short a window logs out a
 * creator who leaves the portal open, and the exchange happens once at launch.
 */
const MAX_INIT_DATA_AGE_MS = 24 * 60 * 60 * 1000;

export interface TelegramWebAppUser {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}

export function verifyTelegramInitData(initData: string): TelegramWebAppUser | null {
  const token = botToken();
  if (!token || !initData) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get('hash');
  if (!hash) return null;

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  // Constant-time, and length-guarded because timingSafeEqual throws on a
  // length mismatch rather than returning false.
  const provided = Buffer.from(hash, 'utf8');
  const expected = Buffer.from(computed, 'utf8');
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return null;
  if (Date.now() - authDate * 1000 > MAX_INIT_DATA_AGE_MS) return null;

  const rawUser = params.get('user');
  if (!rawUser) return null;
  try {
    const user = JSON.parse(rawUser) as {
      id?: number | string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    if (user.id === undefined || user.id === null) return null;
    return {
      id: String(user.id),
      username: user.username ?? null,
      firstName: user.first_name ?? null,
      lastName: user.last_name ?? null,
    };
  } catch {
    return null;
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

  const chatIds = await resolveChatIds(recipientUids);
  if (chatIds.length === 0) {
    return { sent: 0, failed: 0, skipped: true, error: 'No recipient has linked Telegram' };
  }

  const html = buildMessageHtml(payload);
  const results = await Promise.all(chatIds.map(chatId => sendTelegramMessage(chatId, html)));

  const failures = results.filter(r => !r.ok);
  return {
    sent: results.length - failures.length,
    failed: failures.length,
    skipped: false,
    error: failures[0]?.error,
  };
}
