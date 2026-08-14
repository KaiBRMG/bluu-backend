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
  type OFAttachment,
  type OFAttachmentType,
  type OFChat,
  type OFChatPage,
  type OFMessage,
  type OFMessagePage,
  type OFStagedMedia,
  type OFVaultList,
  type OFVaultPage,
  type OFWebhookEvent,
  type ResolvedMedia,
  type SendMessageInput,
  type VaultQuery,
} from '../types';

const BASE_URL = 'https://app.onlyfansapi.com';

/**
 * The only URLs `resolveMediaUrl` will hand to the download endpoint. Media
 * links reach us from the client (they arrive on a message page and come back
 * on a resolve request), so they are untrusted input: without this an operator
 * — or anything that can reach the route — could aim the provider's fetcher at
 * an arbitrary host.
 */
const CDN_URL_PATTERN = /^https:\/\/cdn\d*\.onlyfans\.com\/[^\s]*$/i;

/**
 * Hosts the download endpoint is allowed to redirect us to. `cdn.fansapi.com`
 * is the provider's cache (free); `dl.fansapi.com` streams through the account
 * proxy (billed). Anything else means the provider changed its scheme, and we
 * fail rather than hand the renderer an unexpected origin.
 */
const MEDIA_REDIRECT_HOSTS = new Set(['cdn.fansapi.com', 'dl.fansapi.com']);

/**
 * How long a resolved URL is worth reusing.
 *
 * Note this is the lifetime of the **resolved** `*.fansapi.com` link, not of the
 * `cdn*.onlyfans.com` source the docs argue with themselves about (~20 minutes
 * per the `cdnUrl` parameter, "under a minute" per the 403 FAQ).
 *
 * It was briefly 45s, matching the pessimistic source figure, and that was a
 * cost bug rather than a safety margin: re-resolving is **billed**, and a tile
 * scrolled out of view and back is the most ordinary thing an operator does. So
 * this is generous, and correctness comes from the consumer instead — the
 * renderer re-resolves on an actual image load failure. Optimistic with a real
 * fallback beats pessimistic with a bill.
 */
const RESOLVED_MEDIA_TTL_MS = 5 * 60 * 1000;

/**
 * The vault-lists endpoint's real ceiling. Its OpenAPI entry documents only a
 * default of 24 and no maximum; asking for more returns **422 "The limit field
 * must not be greater than 30."** Categories are therefore paged.
 */
const VAULT_LISTS_PAGE_MAX = 30;
/** Bound on that walk. 300 folders is far past any real vault. */
const VAULT_LISTS_MAX_PAGES = 10;

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

const ATTACHMENT_TYPES: readonly OFAttachmentType[] = ['photo', 'video', 'gif', 'audio'];

function toDimension(value: unknown): number | null {
  const n = toNumber(value);
  return n > 0 ? n : null;
}

/** A CDN link, or null when the provider omitted it (locked or DRM media). */
function toCdnUrl(value: unknown): string | null {
  return typeof value === 'string' && CDN_URL_PATTERN.test(value) ? value : null;
}

/**
 * One entry of a message's `media[]`.
 *
 * The DRM test is the presence of `files.drm`, **not** `convertedToVideo`. The
 * provider's FAQ claims a null `files.full.url` means "still converting", but
 * its own examples disprove that: a plain video ships `convertedToVideo: false`
 * with a populated `full.url`, while the DRM example is `isReady: true`,
 * `canView: true` and has no full file at all. Following the FAQ would mount a
 * player on every DRM message and have it fail silently.
 */
export function normaliseAttachment(raw: Raw): OFAttachment | null {
  const id = toId(raw.id);
  if (!id) return null;

  const files: Raw = raw.files ?? {};
  const rawType = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  const type = (ATTACHMENT_TYPES as readonly string[]).includes(rawType)
    ? (rawType as OFAttachmentType)
    : 'other';

  const full = toCdnUrl(files.full?.url);
  const preview = toCdnUrl(files.preview?.url) ?? toCdnUrl(files.squarePreview?.url);
  const isDrm = !!files.drm && !full;

  const duration = toNumber(raw.duration);

  return {
    id,
    type,
    canView: raw.canView !== false,
    isDrm,
    width: toDimension(files.full?.width ?? files.preview?.width),
    height: toDimension(files.full?.height ?? files.preview?.height),
    duration: duration > 0 ? duration : null,
    urls: { full, preview, thumb: toCdnUrl(files.thumb?.url) },
  };
}

/**
 * The sentence the provider generates as a tip's body, e.g.
 * `I sent you a $150.00 tip`. It is boilerplate, not something the fan typed —
 * rendering it verbatim tells the operator nothing and buries any real note
 * underneath it.
 *
 * Anchored at the start and tolerant of trailing punctuation, so a fan's own
 * note appended after it survives in the capture group.
 */
const TIP_SENTENCE =
  /^\s*i\s+sent\s+you\s+a\s+\$?\s*([\d,]+(?:\.\d+)?)\s*tip\b[.!\s]*/i;

/** `"$150.00"`, `"150"`, `150` → `150`. Returns 0 for anything unparseable. */
function toMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const n = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pull the amount and the fan's own note out of a tip.
 *
 * **`price` is 0 on a tip** — confirmed against the live account, and the reason
 * an earlier pass rendered every tip as "$0". The provider's OpenAPI document
 * does not describe a tip-amount field at all (its message examples omit it), so
 * this probes the plausible spellings first and then falls back to reading the
 * figure out of the provider's own generated sentence, which is the one place
 * the amount is *known* to appear.
 *
 * The same sentence is stripped from the body, so what survives in `text` is
 * only what the fan actually wrote.
 */
function parseTip(raw: Raw, text: string): { amount: number; note: string } {
  const field =
    toMoney(raw.tipAmount) ||
    toMoney(raw.tipsAmount) ||
    toMoney(raw.tipsAmountRaw) ||
    toMoney(raw.amount) ||
    toMoney(raw.price);

  const match = text.match(TIP_SENTENCE);

  // The fan's note, if the provider carries one in a field of its own.
  //
  // **Unverified.** The documented message schema has exactly one text field and
  // no note field, and stripping the generated sentence leaves nothing behind —
  // so wherever the note lives, it is not in `text`. These spellings are the
  // plausible candidates, probed the same defensive way as `parseWebhookEvent`.
  // If none of them is right, `ONLYFANS_DEBUG_TIPS` below is how we find out
  // without spending a single extra provider call.
  const noteField =
    firstString(raw.tipComment, raw.tipMessage, raw.tipText, raw.comment, raw.note, raw.description);

  const stripped = match ? text.slice(match[0].length).trim() : text;

  return {
    amount: field || toMoney(match?.[1]),
    note: stripped || noteField,
  };
}

/** First argument that is a non-empty string once HTML-stripped. */
function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = htmlToText(value);
    if (text) return text;
  }
  return '';
}

/**
 * TEMPORARY diagnostic — remove once the tip payload is pinned down.
 *
 * The provider's OpenAPI document does not describe the tip amount **or** the
 * fan's accompanying note, and three separate attempts to infer them from the
 * documented schema were wrong. This logs the raw payload of a tip so the real
 * field names can be read off a request the operator was making anyway.
 *
 * **It costs nothing.** It piggybacks on the history fetch that opening a thread
 * already performs — no extra provider call, which matters because every call is
 * billed (rule 9b in CLAUDE.md forbids calling the API to investigate).
 *
 * Off unless `ONLYFANS_DEBUG_TIPS=1`. Tips are rare, so even on it is quiet.
 * Note the payload includes the fan's own words: enable it locally, read the
 * line, turn it off. Do not leave it on in production.
 */
function debugLogTipPayload(raw: Raw): void {
  if (process.env.ONLYFANS_DEBUG_TIPS !== '1') return;
  try {
    console.log('[onlyfans][tip-payload]', JSON.stringify(raw));
  } catch {
    console.log('[onlyfans][tip-payload] keys:', Object.keys(raw).join(','));
  }
}

export function normaliseMessage(raw: Raw, chatId: string): OFMessage | null {
  const id = toId(raw.id);
  if (!id) return null;
  const attachments = Array.isArray(raw.media)
    ? raw.media.map(normaliseAttachment).filter((a: OFAttachment | null): a is OFAttachment => a !== null)
    : [];

  const isTip = raw.isTip === true;
  const text = htmlToText(raw.text);
  if (isTip) debugLogTipPayload(raw); // TEMPORARY — see debugLogTipPayload
  const tip = isTip ? parseTip(raw, text) : null;

  return {
    id,
    chatId,
    text: tip ? tip.note : text,
    createdAt: toIso(raw.createdAt) ?? toIso(raw.changedAt) ?? new Date(0).toISOString(),
    fromMe: isFromMe(raw, chatId),
    // Kept strictly as the PPV unlock price; a tip's money lives in `tipAmount`.
    price: isTip ? 0 : toNumber(raw.price),
    isTip,
    tipAmount: tip?.amount ?? 0,
    isOpened: raw.isOpened === true,
    mediaCount: toNumber(raw.mediaCount) || attachments.length,
    attachments,
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
          // `FormData` must set its own Content-Type: the boundary is generated
          // by fetch, and declaring `application/json` over it produces a body
          // the provider cannot parse.
          ...(rest.body && !(rest.body instanceof FormData)
            ? { 'Content-Type': 'application/json' }
            : {}),
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
    const mediaIds = input.mediaIds ?? [];
    const price = input.price ?? 0;
    const body = await this.request<Envelope<Raw>>(
      `/api/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          text: input.text,
          ...(input.replyToMessageId ? { replyToMessageId: Number(input.replyToMessageId) } : {}),
          // `mediaFiles` takes staged upload ids and vault ids interchangeably,
          // so the composer hands us one flat list and this never branches.
          ...(mediaIds.length > 0 ? { mediaFiles: mediaIds } : {}),
          ...(price > 0
            ? {
                price,
                // With a price set, `mediaFiles` becomes the *locked* set and
                // `previews` the visible exception to it. Sending an empty
                // `previews` is meaningful — it means the whole set is locked.
                previews: input.previewIds ?? [],
                ...(input.lockedText ? { lockedText: true } : {}),
              }
            : {}),
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

  // ─── Vault ────────────────────────────────────────────────────────

  /**
   * Vault categories.
   *
   * **The provider caps `limit` at 30 here and 422s above it** — a constraint its
   * own OpenAPI document does not state (the parameter is described only as
   * "Default: 24"). Found the hard way; do not raise it back.
   *
   * So a creator with more than 30 folders needs paging, which is why this walks
   * offsets rather than asking for one big page. The walk is bounded: this is a
   * memoised, once-per-half-hour call, but it is still billed per page and an
   * unbounded loop against a provider that stops decrementing is a bill, not a
   * hang.
   */
  async listVaultLists(
    accountId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<OFVaultList[]> {
    const limit = Math.min(Math.max(opts.limit ?? VAULT_LISTS_PAGE_MAX, 1), VAULT_LISTS_PAGE_MAX);
    const lists: OFVaultList[] = [];

    for (let page = 0; page < VAULT_LISTS_MAX_PAGES; page += 1) {
      const body = await this.request<Envelope<Raw>>(
        `/api/${encodeURIComponent(accountId)}/media/vault/lists`,
        { query: { limit, offset: (opts.offset ?? 0) + page * limit } },
      );

      const rows: Raw[] = body.data?.list ?? [];
      for (const raw of rows) {
        const id = toId(raw.id);
        if (!id) continue;
        lists.push({
          id,
          name: typeof raw.name === 'string' ? raw.name : 'Untitled',
          kind: typeof raw.type === 'string' ? raw.type : 'custom',
          counts: {
            photos: toNumber(raw.photosCount),
            videos: toNumber(raw.videosCount),
            gifs: toNumber(raw.gifsCount),
            audios: toNumber(raw.audiosCount),
          },
        });
      }

      // A short page is the end of the vault. `hasMore` is reported here too,
      // but the length test is the one that cannot lie us into another billed
      // request.
      if (rows.length < limit || body.data?.hasMore !== true) break;
    }

    return lists;
  }

  /**
   * A page of vault media.
   *
   * A vault entry and a message attachment are the same provider object, so this
   * reuses `normaliseAttachment` wholesale — same DRM test, same locked test,
   * same expiring URLs that must be resolved rather than persisted.
   */
  async listVaultMedia(accountId: string, opts: VaultQuery = {}): Promise<OFVaultPage> {
    const limit = Math.min(Math.max(opts.limit ?? 24, 10), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const body = await this.request<Envelope<Raw>>(
      `/api/${encodeURIComponent(accountId)}/media/vault`,
      {
        query: {
          limit,
          offset,
          field: 'recent',
          sort: 'desc',
          type: opts.type,
          list: opts.listId,
          query: opts.query,
        },
      },
    );

    const rows: Raw[] = body.data?.list ?? [];
    const media = rows
      .map(normaliseAttachment)
      .filter((a: OFAttachment | null): a is OFAttachment => a !== null);

    return {
      media,
      // `hasMore` is the provider's own flag; the offset is ours to track. A
      // page that came back empty ends the walk regardless of what it claims.
      nextOffset: body.data?.hasMore === true && media.length > 0 ? offset + rows.length : null,
    };
  }

  /**
   * Stage a file with the provider by handing it a URL to fetch.
   *
   * We deliberately do **not** proxy bytes: the caller puts the file somewhere
   * the provider can reach and passes the link, so a 200MB video never travels
   * through our own request path. `async` is left off, so the 200 means the
   * provider has the file and the id is immediately usable.
   */
  async uploadMediaFromUrl(accountId: string, fileUrl: string): Promise<OFStagedMedia> {
    const form = new FormData();
    form.append('file_url', fileUrl);

    const body = await this.request<Raw>(
      `/api/${encodeURIComponent(accountId)}/media/upload`,
      { method: 'POST', body: form },
    );

    // The endpoint answers bare, not enveloped — but tolerate both.
    const id = toId(body.prefixed_id) ?? toId(body.data?.prefixed_id);
    if (!id) throw new OnlyFansApiError('Provider accepted the upload but returned no media id', 502);
    return { id };
  }

  /**
   * Resolve one expiring CDN link into something a browser can load.
   *
   * `GET /media/download/{cdnUrl}` answers `302` to either the provider's cache
   * (free) or its streaming proxy (billed). We follow it **manually** and hand
   * the `Location` back rather than following it with `fetch`, for two reasons:
   * the redirect target is a different origin and must never see the API key,
   * and the renderer needs the URL itself to put in an `<img>`/`<video>`.
   *
   * That is also why the origin guard in `request()` needs no relaxing — the
   * only request we make is to the provider, exactly as before.
   */
  async resolveMediaUrl(accountId: string, cdnUrl: string): Promise<ResolvedMedia> {
    if (!CDN_URL_PATTERN.test(cdnUrl)) {
      throw new OnlyFansApiError('Not an OnlyFans CDN URL', 400);
    }

    // The whole URL — query string, policy and signature included — is one path
    // segment, so every reserved character has to survive encoding.
    const path = `/api/${encodeURIComponent(accountId)}/media/download/${encodeURIComponent(cdnUrl)}`;

    let response: Response;
    try {
      response = await fetch(new URL(path, BASE_URL), {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: '*/*' },
        redirect: 'manual',
        cache: 'no-store',
      });
    } catch (err) {
      throw new OnlyFansApiError(
        `OnlyFans provider unreachable: ${err instanceof Error ? err.message : 'network error'}`,
        503,
      );
    }

    if (response.status === 403 || response.status === 404) {
      // The documented meaning of a 403 here is an expired source link. The
      // caller's fix is to re-fetch the message page, not to retry this.
      throw new OnlyFansApiError('Media link has expired', 403);
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new OnlyFansApiError(
        `Provider did not redirect the media download (${response.status})`,
        response.status >= 400 ? response.status : 502,
      );
    }

    let host: string;
    try {
      host = new URL(location).hostname.toLowerCase();
    } catch {
      throw new OnlyFansApiError('Provider returned an unusable media redirect', 502);
    }
    if (!MEDIA_REDIRECT_HOSTS.has(host)) {
      throw new OnlyFansApiError(`Unexpected media redirect host ${host}`, 502);
    }

    return { url: location, ttlMs: RESOLVED_MEDIA_TTL_MS };
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
