/**
 * `IOnlyFansClient` implementation for **OnlyFansAPI** (app.onlyfansapi.com).
 *
 * This is the ONLY file in the repo that knows the provider's URLs, payload
 * shapes, or auth scheme. Everything above it speaks the domain model in
 * `../types.ts`. To move to another provider, add a sibling file here and point
 * the factory in `../index.ts` at it — nothing else changes.
 *
 * Server-only: it reads `ONLYFANSAPI_API_KEY`.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import {
  OnlyFansApiError,
  type IOnlyFansClient,
  type OFAccount,
  type OFChat,
  type OFChatPage,
  type OFMessage,
  type OFMessagePage,
  type OFWebhookEvent,
  type SendMessageInput,
} from '../types';

const BASE_URL = 'https://app.onlyfansapi.com';

/** Header names providers commonly use for the body HMAC. */
const SIGNATURE_HEADERS = ['x-signature', 'x-ofapi-signature', 'x-webhook-signature'];

/** Provider responses wrap everything in `data` and add `_pagination` / `_meta`. */
interface Envelope<T> {
  data: T;
  _pagination?: { next_page?: string | null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

// ─── Normalisation helpers ──────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * Message bodies arrive as HTML (`<p>text</p>`, `<br />`). The UI renders text
 * nodes only — never `dangerouslySetInnerHTML` — so strip to plain text here,
 * at the boundary, rather than trusting any consumer to do it.
 */
export function htmlToText(html: unknown): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .trim();
}

function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function toId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/**
 * `isSentByMe` is present on the messages endpoint but not on the `lastMessage`
 * embedded in a chat row, so fall back to comparing the sender against the fan.
 */
function isFromMe(raw: Raw, chatId: string): boolean {
  if (typeof raw.isSentByMe === 'boolean') return raw.isSentByMe;
  const fromUserId = toId(raw.fromUser?.id);
  return fromUserId !== null && fromUserId !== chatId;
}

export function normaliseMessage(raw: Raw, chatId: string): OFMessage | null {
  const id = toId(raw.id);
  if (!id) return null;
  return {
    id,
    chatId,
    text: htmlToText(raw.text),
    createdAt: toIso(raw.createdAt) ?? toIso(raw.changedAt) ?? new Date(0).toISOString(),
    fromMe: isFromMe(raw, chatId),
    price: toNumber(raw.price),
    isTip: raw.isTip === true,
    isOpened: raw.isOpened === true,
    mediaCount: toNumber(raw.mediaCount) || (Array.isArray(raw.media) ? raw.media.length : 0),
  };
}

function normaliseChat(raw: Raw): OFChat | null {
  const fanRaw: Raw = raw.fan ?? raw.withUser ?? {};
  const chatId = toId(fanRaw.id) ?? toId(raw.id);
  if (!chatId) return null;

  const last = raw.lastMessage ? normaliseMessage(raw.lastMessage, chatId) : null;

  return {
    id: chatId,
    fan: {
      id: chatId,
      name: typeof fanRaw.name === 'string' ? fanRaw.name : `u${chatId}`,
      username: typeof fanRaw.username === 'string' ? fanRaw.username : `u${chatId}`,
      avatar: typeof fanRaw.avatar === 'string' ? fanRaw.avatar : null,
    },
    lastMessageId: last?.id ?? null,
    lastMessageText: last?.text ?? '',
    lastMessageAt: last?.createdAt ?? null,
    lastMessageFromMe: last?.fromMe ?? false,
    unreadCount: toNumber(raw.unreadMessagesCount),
    spentTotal: toNumber(fanRaw.subscribedOnData?.totalSumm),
    isPinned: raw.isPinned === true,
    canSendMessage: raw.canSendMessage !== false,
  };
}

// ─── Client ─────────────────────────────────────────────────────────

export class OnlyFansApiClient implements IOnlyFansClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(
    path: string,
    init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const { query, ...rest } = init;
    const url = path.startsWith('http') ? new URL(path) : new URL(path, BASE_URL);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
    }
    // A cursor is an opaque provider URL we hand back to ourselves; still refuse
    // to send the API key anywhere but the provider's host.
    if (url.origin !== BASE_URL) {
      throw new OnlyFansApiError(`Refusing to call foreign origin ${url.origin}`, 400);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...rest,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
          ...(rest.headers ?? {}),
        },
        cache: 'no-store',
      });
    } catch (err) {
      throw new OnlyFansApiError(
        `OnlyFans provider unreachable: ${err instanceof Error ? err.message : 'network error'}`,
        503,
      );
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        (body as Raw)?.message ?? (body as Raw)?.error ?? `Provider returned ${response.status}`;
      throw new OnlyFansApiError(String(message), response.status, body);
    }
    return body as T;
  }

  async listAccounts(): Promise<OFAccount[]> {
    // This endpoint returns a bare array, not the usual envelope.
    const body = await this.request<Raw[] | Envelope<Raw[]>>('/api/accounts');
    const rows = Array.isArray(body) ? body : (body?.data ?? []);
    return rows.map((raw) => ({
      id: String(raw.id),
      username: raw.onlyfans_username ?? '',
      displayName: raw.display_name ?? raw.onlyfans_user_data?.name ?? raw.onlyfans_username ?? '',
      avatar: raw.onlyfans_user_data?.avatar ?? null,
      isAuthenticated: raw.is_authenticated === true,
    }));
  }

  async listChats(
    accountId: string,
    opts: { limit?: number; offset?: number; query?: string } = {},
  ): Promise<OFChatPage> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const body = await this.request<Envelope<Raw[]>>(
      `/api/${encodeURIComponent(accountId)}/chats`,
      { query: { limit, offset, order: 'recent', query: opts.query } },
    );
    const chats = (body.data ?? []).map(normaliseChat).filter((c): c is OFChat => c !== null);
    return {
      chats,
      // The provider only reports a `next_page` URL; offsets are ours to track.
      nextOffset: body._pagination?.next_page ? offset + chats.length : null,
    };
  }

  async listMessages(
    accountId: string,
    chatId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<OFMessagePage> {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    // The cursor IS the provider's own `next_page` URL — following it verbatim
    // is the only paging scheme documented to be stable here.
    const body = opts.cursor
      ? await this.request<Envelope<Raw[]>>(opts.cursor)
      : await this.request<Envelope<Raw[]>>(
          `/api/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chatId)}/messages`,
          { query: { limit, order: 'desc', skip_users: 'all' } },
        );

    const messages = (body.data ?? [])
      .map((raw) => normaliseMessage(raw, chatId))
      .filter((m): m is OFMessage => m !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const next = body._pagination?.next_page;
    return {
      messages,
      // A next_page pointing at an empty result is how the thread ends; the
      // caller stops when a page comes back empty.
      nextCursor: typeof next === 'string' && next && messages.length > 0 ? next : null,
    };
  }

  async sendMessage(
    accountId: string,
    chatId: string,
    input: SendMessageInput,
  ): Promise<OFMessage> {
    const body = await this.request<Envelope<Raw>>(
      `/api/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          text: input.text,
          ...(input.replyToMessageId ? { replyToMessageId: Number(input.replyToMessageId) } : {}),
        }),
      },
    );
    const message = normaliseMessage(body.data ?? {}, chatId);
    if (!message) throw new OnlyFansApiError('Provider accepted the send but returned no message', 502);
    // The send response omits isSentByMe; it is ours by definition.
    return { ...message, fromMe: true };
  }

  async markChatRead(accountId: string, chatId: string): Promise<void> {
    await this.request(
      `/api/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chatId)}/mark-as-read`,
      { method: 'POST' },
    );
  }

  // ─── Webhooks ─────────────────────────────────────────────────────

  /**
   * The provider documents its webhook *event names* but not the delivery
   * headers, so the signature is checked opportunistically: when a recognised
   * header is present it must be a valid HMAC-SHA256 of the raw body; when none
   * is, the path secret the caller already validated is the whole credential.
   */
  verifyWebhookSignature(rawBody: string, headers: Headers, secret: string): boolean {
    const header = SIGNATURE_HEADERS.map((h) => headers.get(h)).find(Boolean);
    if (!header) return true;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    // Some providers prefix the scheme (`sha256=…`).
    const provided = (header.includes('=') ? header.split('=').pop()! : header).trim();
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Written defensively on purpose: the OpenAPI document lists the event names
   * but no payload bodies, so each field is probed across the plausible
   * spellings. Anything unrecognised returns null and is dropped — the chat
   * sync is the backstop, so a missed delivery is a delay, not data loss.
   */
  parseWebhookEvent(payload: unknown): OFWebhookEvent | null {
    if (!payload || typeof payload !== 'object') return null;
    const body = payload as Raw;

    const event: string = body.event ?? body.type ?? body.event_type ?? '';
    if (event !== 'messages.received' && event !== 'messages.sent') return null;

    const data: Raw = body.data ?? body.payload ?? body;
    const rawMessage: Raw = data.message ?? data;

    const accountId = body.account_id ?? body.accountId ?? data.account_id ?? data.accountId;
    const chatId =
      data.chat_id ??
      data.chatId ??
      rawMessage.chat_id ??
      // Inbound: the sender is the fan, and a fan's user id *is* the chat id.
      (event === 'messages.received' ? rawMessage.fromUser?.id : undefined) ??
      data.toUser?.id ??
      data.withUser?.id;

    if (!accountId || chatId === undefined || chatId === null) return null;

    const message = normaliseMessage(rawMessage, String(chatId));
    if (!message) return null;

    const inbound = event === 'messages.received';
    return {
      kind: 'message',
      accountId: String(accountId),
      message: { ...message, fromMe: !inbound },
      inbound,
    };
  }
}
