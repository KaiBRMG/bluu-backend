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
import { PAGES } from '@/lib/definitions';
import { adminDb } from '@/lib/firebase-admin';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export interface TelegramMessagePayload {
  title: string;
  message: string;
  /** App path or external URL — see `resolveActionLine` for how each is rendered. */
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

/**
 * Chat id for a single creator, or null if they have not linked Telegram.
 *
 * Deliberately separate from `resolveChatIds`: that function's uids are
 * `users` docs by definition (in-app notification recipients), and a creator
 * uid handed to it would silently resolve to nothing. Every *automated*
 * creator notification names exactly one creator, so a single field-masked
 * read is enough there — a manual admin broadcast to many creators at once
 * uses the batched `resolveCreatorChatIds` below instead.
 */
export async function resolveCreatorChatId(creatorUid: string): Promise<string | null> {
  if (!creatorUid) return null;
  const snap = await adminDb.collection('creators').doc(creatorUid).get();
  const chatId = snap.get('telegram.chatId');
  return typeof chatId === 'string' && chatId ? chatId : null;
}

/**
 * Chat ids for a set of creators — the `creators`-collection analogue of
 * `resolveChatIds`. Used only by the manual admin broadcast path, which is
 * the one place many creators are notified in a single fan-out (every
 * automated creator event names one creator and uses `resolveCreatorChatId`).
 */
export async function resolveCreatorChatIds(creatorUids: string[]): Promise<string[]> {
  const uids = [...new Set(creatorUids.filter(Boolean))];
  if (uids.length === 0) return [];

  const refs = uids.map((uid) => adminDb.collection('creators').doc(uid));
  const snaps = await adminDb.getAll(...refs, { fieldMask: ['telegram.chatId'] });

  const chatIds = new Set<string>();
  for (const snap of snaps) {
    const chatId: unknown = snap.get('telegram.chatId');
    if (typeof chatId === 'string' && chatId) chatIds.add(chatId);
  }
  return [...chatIds];
}

/**
 * Sends pre-formatted Telegram HTML to one creator.
 *
 * Creators have no in-app notification tray (telegram.md), so for them
 * Telegram is not an *additional* channel — it is the only one. Still never
 * throws, for the same reason `sendTelegramNotification` does not: a Telegram
 * outage must not fail the request that triggered it (approving a request,
 * creating a content brief).
 */
export async function sendTelegramToCreator(
  creatorUid: string,
  html: string,
): Promise<{ ok: boolean; skipped: boolean; error?: string }> {
  if (!isTelegramConfigured()) {
    return { ok: false, skipped: true, error: 'Telegram bot token not configured' };
  }
  const chatId = await resolveCreatorChatId(creatorUid);
  if (!chatId) {
    return { ok: false, skipped: true, error: 'Creator has not linked Telegram' };
  }
  const res = await sendTelegramMessage(chatId, html);
  return { ok: res.ok, skipped: false, error: res.error };
}

/** Telegram HTML parse mode only requires these three to be escaped. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The trailing line to append to the message for an `actionUrl`, or null for
 * none.
 *
 * An external URL is linked directly. An internal app path is **not**
 * linked — `src/middleware.ts` rewrites non-Electron page traffic to
 * `/desktop-only`, so a link to an in-app page opened from a phone is a dead
 * end — but it is not dropped either: it is named ("View on Bluu Backend >
 * Disputes") off `PAGES` in `definitions.ts` so the recipient at least knows
 * where to go look inside the app. A path with no matching `PageDef` (should
 * not happen — every `actionUrl` this app produces is one of `PAGES`' hrefs)
 * resolves to nothing rather than a broken reference.
 */
function resolveActionLine(actionUrl?: string | null): string | null {
  const target = classifyNotificationAction(actionUrl);
  if (target.kind === 'external') {
    return `<a href="${escapeHtml(target.href)}">Open link</a>`;
  }
  if (target.kind === 'internal') {
    const page = PAGES.find(p => p.href === target.href);
    if (page) return `View on Bluu Backend &gt; ${escapeHtml(page.title)}`;
  }
  return null;
}

function buildMessageHtml({ title, message, actionUrl }: TelegramMessagePayload): string {
  const parts = [`<b>${escapeHtml(title)}</b>`, escapeHtml(message)];
  const actionLine = resolveActionLine(actionUrl);
  if (actionLine) parts.push(actionLine);
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
 * Put a chat's menu button back to Telegram's default.
 *
 * **This is not the inverse of a call we made — it is a correction of one we
 * did not.** A menu button configured globally in BotFather appears in *every*
 * chat with the bot, including a stranger who just pressed Start and an
 * employee who has no portal to open. A per-chat override is the only thing
 * that can suppress it, so the bot has to set this deliberately rather than
 * simply declining to offer a button.
 *
 * The consequence of not doing it is a "Creator Portal" button in the chat of
 * someone with no creator account, which opens a Mini App that can only refuse
 * them — an invitation to a dead end.
 *
 * Idempotent, and safe on a chat that never had a button.
 */
export async function clearChatMenuButton(
  chatId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await callTelegram('setChatMenuButton', {
    chat_id: chatId,
    menu_button: { type: 'default' },
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
 * key-sorted `k=v` string of the received fields, then compare
 * `HMAC(HMAC("WebAppData", bot_token), data_check_string)`. Note the two-level
 * keying — the *secret* is itself an HMAC of the token, not the token.
 *
 * ── Why the `signature` field is tried BOTH ways ─────────────────────────────
 *
 * Telegram later added a `signature` parameter (an Ed25519 signature, so that
 * third parties who do not hold the bot token can validate a launch). Whether it
 * participates in the *HMAC* data-check-string is genuinely ambiguous: the spec
 * says "all received fields except `hash`", which reads as including it, while
 * several official-adjacent client libraries exclude it — and clients that
 * predate the field send no `signature` at all, so both readings agree there.
 *
 * Getting it wrong is total: every launch from a client that sends `signature`
 * fails to verify, and the symptom is a creator who is correctly linked being
 * told to open the app in Telegram — from inside Telegram.
 *
 * So both candidate strings are computed and either match is accepted. They are
 * local HMACs over a few hundred bytes; the cost is nothing, and it removes a
 * documentation ambiguity from the critical path of the portal's only sign-in.
 * **This does not weaken the check** — an attacker must still produce a valid
 * HMAC under the bot token for one of two well-defined strings.
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

/**
 * Why a launch payload was refused. Coarse on purpose — enough to tell a
 * configuration problem from an expiry from a forgery when debugging a creator
 * who cannot get in, without narrating the check to an attacker.
 */
export type InitDataFailure =
  | 'not-configured'
  | 'empty'
  | 'no-hash'
  | 'bad-signature'
  | 'stale'
  | 'no-user';

export type InitDataResult =
  | { ok: true; user: TelegramWebAppUser }
  | { ok: false; reason: InitDataFailure };

/** Constant-time hex compare that tolerates a length mismatch (timingSafeEqual
 *  throws on one rather than returning false). */
function hexEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifyTelegramInitData(initData: string): InitDataResult {
  const token = botToken();
  if (!token) return { ok: false, reason: 'not-configured' };
  if (!initData) return { ok: false, reason: 'empty' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'empty' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no-hash' };

  const build = (excludeSignature: boolean) =>
    [...params.entries()]
      .filter(([key]) => key !== 'hash' && !(excludeSignature && key === 'signature'))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const sign = (data: string) =>
    crypto.createHmac('sha256', secret).update(data).digest('hex');

  // Both readings of the spec — see the header. Identical when the client sends
  // no `signature`, which is the majority of launches.
  const matched =
    hexEquals(hash, sign(build(true))) || hexEquals(hash, sign(build(false)));
  if (!matched) return { ok: false, reason: 'bad-signature' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'stale' };
  if (Date.now() - authDate * 1000 > MAX_INIT_DATA_AGE_MS) return { ok: false, reason: 'stale' };

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, reason: 'no-user' };
  try {
    const user = JSON.parse(rawUser) as {
      id?: number | string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    if (user.id === undefined || user.id === null) return { ok: false, reason: 'no-user' };
    return {
      ok: true,
      user: {
        id: String(user.id),
        username: user.username ?? null,
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
      },
    };
  } catch {
    return { ok: false, reason: 'no-user' };
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

/**
 * The `creators`-collection analogue of `sendTelegramNotification`, for a
 * manual admin broadcast addressed to multiple creators (individually picked,
 * or the "All Creators" pseudo-group). Creators have no in-app tray, so this
 * is not gated behind the admin's "Also send as a Telegram alert" checkbox —
 * the caller (`POST /api/admin/notifications`) sends to creators
 * unconditionally, the same way every automated creator notification does.
 */
export async function sendTelegramNotificationToCreators(
  creatorUids: string[],
  payload: TelegramMessagePayload
): Promise<TelegramSendResult> {
  if (!isTelegramConfigured()) {
    return { sent: 0, failed: 0, skipped: true, error: 'Telegram bot token not configured' };
  }

  const chatIds = await resolveCreatorChatIds(creatorUids);
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
