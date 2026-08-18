/**
 * OnlyFans domain model + provider contract.
 *
 * These types are OUR shape, not the provider's. Nothing outside
 * `src/lib/onlyfans/providers/` may import a provider SDK, hit a provider URL,
 * or reason about a provider payload — swapping providers must be a matter of
 * writing one new `IOnlyFansClient` and changing the factory in `index.ts`.
 *
 * Server-only. Never import from a client component (it would leak the API key
 * into the bundle).
 */

// ─── Domain ─────────────────────────────────────────────────────────

/** A linked OnlyFans account (a creator page we operate on behalf of). */
export interface OFAccount {
  /** Provider-scoped account id, e.g. `acct_XXXX`. Opaque to the app. */
  id: string;
  /** OnlyFans username, e.g. `bluutest`. */
  username: string;
  /** Display name shown on the OF profile. */
  displayName: string;
  /** Avatar URL, when the provider exposes one. */
  avatar: string | null;
  /** False when the session is expired / needs re-auth. */
  isAuthenticated: boolean;
}

/** The other party in a chat — a fan/subscriber. */
export interface OFFan {
  /** OnlyFans user id. Doubles as the chat id. */
  id: string;
  name: string;
  username: string;
  avatar: string | null;
}

/**
 * What the fan context panel shows, and **all of it rides in on the chat list**.
 *
 * The provider's `/chats` payload embeds a full profile object per fan —
 * subscription dates, the spend breakdown, join date, location. Reading it from
 * there and mirroring it costs **zero extra provider calls**; asking
 * `/users/{username}` per opened thread would bill once per chat switch, which
 * on this surface is a call every few seconds.
 *
 * Every field is optional-shaped (`null` / `0`) because the provider documents
 * none of them as guaranteed and its `skip_users` behaviour is unclear. The
 * panel renders a fact only when it has one — it never prints a zero it guessed.
 */
export interface OFFanProfile {
  /** Profile bio, HTML-stripped. */
  about: string;
  location: string | null;
  /** ISO-8601 UTC, or null when the provider omitted it. */
  joinDate: string | null;
  isVerified: boolean;
  /** The fan's current subscription price on this page, USD. 0 = free page. */
  subscribePrice: number;
  subscription: OFFanSubscription | null;
  spend: OFFanSpend | null;
}

/**
 * The fan's subscription **to us** — from `subscribedOnData`, which is also
 * where the provider files the spend sums. (`subscribedByData` is the mirror
 * image: our subscription to them. They are easy to swap and the wrong one is
 * silently plausible, so this is the only place the choice is made.)
 */
export interface OFFanSubscription {
  /** The provider's own words, e.g. `Set to Expire`. Null when it says nothing. */
  status: string | null;
  /** False once the subscription has lapsed. */
  isActive: boolean;
  /** Human-readable run length as the provider phrases it, e.g. `22 days`. */
  duration: string | null;
  subscribedAt: string | null;
  expiresAt: string | null;
  renewedAt: string | null;
}

/**
 * Lifetime spend, split by where it came from. `total` is the provider's own
 * `totalSumm` rather than a sum of the parts — the parts are not documented as
 * exhaustive, and a total we computed could disagree with OnlyFans' own.
 */
export interface OFFanSpend {
  total: number;
  tips: number;
  messages: number;
  posts: number;
  streams: number;
  subscriptions: number;
}

/** What kind of file an attachment is. `other` covers anything unmodelled. */
export type OFAttachmentType = 'photo' | 'video' | 'gif' | 'audio' | 'other';

/**
 * The renditions of one attachment that can be displayed, cheapest first.
 *
 * **This is a cost ordering, not a quality one.** The provider bills a media
 * download at roughly 3 credits per megabyte with a 1-credit floor, so the gap
 * between `video720` and `full` on a source-resolution clip is the difference
 * between tens of credits and hundreds. Everything that asks for media names the
 * variant it wants, and the caches key on it.
 */
export type OFMediaVariant = 'thumb' | 'preview' | 'video240' | 'video720' | 'full';

/**
 * Variants big enough that fetching one is a deliberate act rather than a tile
 * rendering itself. These go one at a time through the file route, never in a
 * viewport-driven batch.
 */
export const LARGE_MEDIA_VARIANTS: readonly OFMediaVariant[] = ['video240', 'video720', 'full'];

/**
 * One piece of media on a message.
 *
 * **The URLs in `urls` are short-lived, IP-locked provider CDN links.** They
 * cannot be fetched by a browser and they expire in about a minute, so they must
 * never be mirrored into Firestore or cached beyond the life of the message page
 * that produced them. To display one, hand it to `resolveMediaUrl` and use what
 * comes back. Everything else on this interface is durable metadata.
 */
export interface OFAttachment {
  id: string;
  type: OFAttachmentType;
  /**
   * False for a PPV the fan has not unlocked: only `thumb`/`preview` exist and
   * the full file must not be requested.
   */
  canView: boolean;
  /**
   * True when the provider serves this only as DRM-protected HLS/DASH. Such
   * media **cannot be played in this app** — stock Electron ships without a
   * Widevine CDM. Render the preview and say so; never mount a player.
   *
   * Derived from the presence of DRM manifests, never from `convertedToVideo` —
   * the provider's own FAQ gets that wrong (a plain video can carry
   * `convertedToVideo: false` and still have a downloadable file).
   */
  isDrm: boolean;
  width: number | null;
  height: number | null;
  /** Seconds. Video/audio only; null otherwise. */
  duration: number | null;
  /**
   * Size of the **full** file in bytes, when the provider reports one.
   *
   * Often 0 (and therefore null here) — the provider's own examples show
   * `files.full.size: 0` on media that plainly has a size. Treat it as a bonus:
   * when it is there, the UI can price a download before the operator commits to
   * it; when it is not, say nothing rather than guess.
   */
  sizeBytes: number | null;
  /**
   * Expiring provider CDN URLs — see the interface note. Any may be null.
   *
   * `video240` / `video720` are the provider's transcoded renditions of a video
   * (`videoSources` on the raw payload). They are typically a small fraction of
   * `full`, which is the source master an operator's phone recorded, and
   * **playing `full` when a rendition exists is the single most expensive thing
   * this app can do.** Prefer a rendition; make `full` an explicit choice.
   */
  urls: {
    full: string | null;
    preview: string | null;
    thumb: string | null;
    video240: string | null;
    video720: string | null;
  };
}

/** One message in a chat, normalised to plain text. */
export interface OFMessage {
  id: string;
  chatId: string;
  /** Plain text — provider HTML (`<p>…</p>`) is stripped upstream. */
  text: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** True when sent by the creator (us), false when sent by the fan. */
  fromMe: boolean;
  /**
   * The **PPV unlock price** in USD; 0 for a free message, and always 0 on a
   * tip. Tips carry their money in `tipAmount` instead — the provider reports
   * `price: 0` on them, so the two were never the same number.
   */
  price: number;
  /**
   * True for a tip. A tip may carry `text` as well — the fan's own note, which
   * the adapter separates from the provider's generated "I sent you a $x tip"
   * boilerplate — so it is a real message and not just an amount.
   */
  isTip: boolean;
  /**
   * The amount tipped in USD; 0 when this is not a tip.
   *
   * The provider's OpenAPI document describes no tip-amount field, so the
   * adapter probes the plausible spellings and falls back to reading the figure
   * out of the generated sentence. **Treat a 0 here on a real tip as a parsing
   * gap, not as a free tip.**
   */
  tipAmount: number;
  /** For PPV: whether the fan has unlocked it. Meaningless on a tip. */
  isOpened: boolean;
  /**
   * Number of attachments as the provider reports it. Kept alongside
   * `attachments` because the two can disagree: a chat row's embedded
   * `lastMessage` carries a count with no `media[]` array, and locked media is
   * sometimes counted but not described.
   */
  mediaCount: number;
  /**
   * The attachments themselves, when the provider described them. May be empty
   * while `mediaCount > 0` — see above; render a count-only affordance then.
   */
  attachments: OFAttachment[];
  /** Pinned to the top of the thread on OnlyFans itself. */
  isPinned: boolean;
  /** Liked (the heart), by us. The provider reports no fan-side like. */
  isLiked: boolean;
  /**
   * Whether the provider will accept a pin for this message. Some cannot be
   * pinned (its rules are undocumented), and offering the action anyway means an
   * error toast instead of a disabled item.
   */
  canBePinned: boolean;
}

/** A chat thread as shown in the list. */
export interface OFChat {
  /** Chat id (the fan's OnlyFans user id). */
  id: string;
  fan: OFFan;
  lastMessageId: string | null;
  lastMessageText: string;
  /** ISO-8601 UTC, or null when the thread has no messages. */
  lastMessageAt: string | null;
  /** True when the last message was sent by us. */
  lastMessageFromMe: boolean;
  unreadCount: number;
  /** Lifetime spend, when the provider reports it. Drives the list's amount chip. */
  spentTotal: number;
  isPinned: boolean;
  canSendMessage: boolean;
  /**
   * The fan's profile as the chat payload carries it — the fan context panel's
   * entire data source. Null when the provider sent no profile object.
   */
  profile: OFFanProfile | null;
}

// ─── Paging ─────────────────────────────────────────────────────────

export interface OFChatPage {
  chats: OFChat[];
  /** Offset to pass back for the next page, or null when exhausted. */
  nextOffset: number | null;
}

export interface OFMessagePage {
  /** Ordered newest → oldest. */
  messages: OFMessage[];
  /**
   * Opaque cursor for the next (older) page, or null at the top of the thread.
   * Callers must treat it as a token and never parse it.
   */
  nextCursor: string | null;
}

/** A playable/renderable media URL, plus how long it is worth caching. */
export interface ResolvedMedia {
  /** Fetchable by a browser. Still short-lived — do not persist it. */
  url: string;
  /** Milliseconds this URL may be reused for. */
  ttlMs: number;
  /**
   * True when fetching `url` will be **billed** by the provider.
   *
   * The download endpoint answers a 302 to one of two hosts: its own CDN cache
   * (free) or a streaming proxy that "reports billing back to the API". The host
   * is therefore a free, exact read on whether these bytes cost money — which is
   * both the metering signal and the trigger for copying them into our own
   * bucket so they are never paid for twice.
   *
   * **A billed URL must never be handed to the renderer.** A `<video>` element
   * issues a fresh range request on every seek, and each one is another stream
   * through the metered proxy.
   */
  billed: boolean;
}

export interface SendMessageInput {
  text: string;
  /** Optional id of the message being replied to. */
  replyToMessageId?: string;
  /**
   * Media to attach. Each entry is either a **staged upload id** (from
   * `uploadMediaFromUrl`) or an **OnlyFans vault media id** — the provider takes
   * both in the same field, so the composer never has to branch on origin.
   *
   * A staged upload id is single-use: once a send consumes it, sending it again
   * attaches nothing. A vault id is durable and may be sent any number of times.
   */
  mediaIds?: string[];
  /**
   * Which of `mediaIds` stay **visible** when `price > 0`. Everything else in
   * `mediaIds` is locked behind the paywall. Meaningless on a free message —
   * nothing is hidden there for a preview to be an exception to.
   *
   * Every entry must also appear in `mediaIds`.
   */
  previewIds?: string[];
  /**
   * PPV price in USD. **0, or between 3 and 200** — the provider rejects
   * anything between the two, and a priced message with no media is rejected
   * outright (there would be nothing to unlock).
   */
  price?: number;
  /** Hide the message text behind the paywall too. Only meaningful with a price. */
  lockedText?: boolean;
}

// ─── Vault ──────────────────────────────────────────────────────────

/**
 * A category in the creator's media vault.
 *
 * Some are OnlyFans' own (`posts`, `stories`, `messages`, `streams`,
 * `media_stickers`); the rest are folders the creator made. Both arrive the same
 * way and are shown the same way — the operator does not care which is which.
 */
export interface OFVaultList {
  id: string;
  name: string;
  /** Provider category kind, e.g. `custom` for a creator-made folder. */
  kind: string;
  /** Per-type counts, as the provider reports them. */
  counts: { photos: number; videos: number; gifs: number; audios: number };
}

/**
 * A page of vault media.
 *
 * The items are `OFAttachment`s: a vault entry and a message attachment are the
 * same object to the provider, so they normalise through one code path and the
 * same tile renders both. Their `urls` expire exactly as fast — resolve, never
 * persist.
 */
export interface OFVaultPage {
  media: OFAttachment[];
  /** Offset to pass back for the next page, or null when exhausted. */
  nextOffset: number | null;
}

/** What a vault listing may be narrowed by. */
export interface VaultQuery {
  /** Restrict to one vault list (category) id. */
  listId?: string;
  type?: 'photo' | 'video' | 'gif' | 'audio';
  query?: string;
  limit?: number;
  offset?: number;
}

/**
 * A file staged with the provider, ready to be attached to a send.
 *
 * **The id is single-use.** The provider spends it on the first message that
 * references it, so a send that fails must retry against the *same* id (the
 * upload is not consumed by a failure) while a send that succeeds must drop it.
 */
export interface OFStagedMedia {
  /** Provider-scoped upload id, `ofapi_media_…`. Opaque to the app. */
  id: string;
}

// ─── Webhooks ───────────────────────────────────────────────────────

/** A provider push, normalised. Only message events are modelled so far. */
export interface OFWebhookEvent {
  kind: 'message';
  accountId: string;
  message: OFMessage;
  /** True when the fan sent it (drives the unread badge). */
  inbound: boolean;
}

// ─── Contract ───────────────────────────────────────────────────────

/**
 * The single seam between this app and whichever third-party OnlyFans provider
 * we are on. Every OnlyFans read/write in the codebase goes through here.
 *
 * Methods throw `OnlyFansApiError` on failure.
 */
export interface IOnlyFansClient {
  /** Linked accounts. Used once, to resolve the account we operate. */
  listAccounts(): Promise<OFAccount[]>;

  listChats(
    accountId: string,
    opts?: { limit?: number; offset?: number; query?: string },
  ): Promise<OFChatPage>;

  /**
   * A page of messages, newest first. Pass `cursor` from a previous page's
   * `nextCursor` to walk backwards through history (the lazy-load path).
   */
  listMessages(
    accountId: string,
    chatId: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<OFMessagePage>;

  sendMessage(accountId: string, chatId: string, input: SendMessageInput): Promise<OFMessage>;

  markChatRead(accountId: string, chatId: string): Promise<void>;

  /**
   * Pin or unpin a message in a thread.
   *
   * The provider's per-message surface is **pin, unpin, like, unlike and
   * nothing else** — in particular there is no unsend, so never design a delete
   * affordance for a sent message.
   */
  setMessagePinned(
    accountId: string,
    chatId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<void>;

  /** Like or unlike a message. */
  setMessageLiked(
    accountId: string,
    chatId: string,
    messageId: string,
    liked: boolean,
  ): Promise<void>;

  /**
   * The creator's private notes on a fan, as plain text. Empty string when there
   * are none.
   *
   * Billed per call and per fan, so it is never fetched with the chat list —
   * only on an explicit request from the fan panel, and memoised behind it.
   */
  getFanNotes(accountId: string, fanId: string): Promise<string>;

  /**
   * The creator's vault categories. Billed, and the answer changes about never —
   * callers memoise it rather than fetching per dialog open.
   */
  listVaultLists(accountId: string, opts?: { limit?: number; offset?: number }): Promise<OFVaultList[]>;

  /** A page of vault media. Billed per call, so page size is the cost knob. */
  listVaultMedia(accountId: string, opts?: VaultQuery): Promise<OFVaultPage>;

  /**
   * Stage a file with the provider so it can be attached to a send.
   *
   * Takes a **URL the provider fetches for itself** rather than bytes, which is
   * what keeps large media off our request path entirely — see the upload route.
   * The URL must be reachable without credentials and is expected to be
   * short-lived.
   */
  uploadMediaFromUrl(accountId: string, fileUrl: string): Promise<OFStagedMedia>;

  /**
   * Turn one expiring `OFAttachment.urls` link into a URL a browser can actually
   * load, and return it with the milliseconds it is good for.
   *
   * Provider CDN links are IP-locked to the provider's proxy, so fetching one
   * directly always fails — every display goes through here. **Fetching what
   * comes back is billed whenever `billed` is true**, so callers must resolve
   * lazily (on viewport) and prefer the smallest variant that will do.
   *
   * Callers must not hand a `billed` URL to a browser: `resolveMediaVariant` in
   * the media cache is the only sanctioned consumer of one, and it streams those
   * bytes into our own bucket exactly once.
   *
   * Throws `OnlyFansApiError` with status 403 when the source URL has expired;
   * the fix is to re-fetch the message page and resolve the fresh URL.
   */
  resolveMediaUrl(accountId: string, cdnUrl: string): Promise<ResolvedMedia>;

  /**
   * Verify a webhook delivery against the shared secret. Signature scheme and
   * header names are provider-specific, so the check belongs behind this seam
   * rather than in the route.
   */
  verifyWebhookSignature(rawBody: string, headers: Headers, secret: string): boolean;

  /**
   * Normalise a webhook body. Returns null for events we do not model and for
   * payloads that cannot be parsed — the caller acks either way, because the
   * chat sync corrects any delivery we drop.
   */
  parseWebhookEvent(payload: unknown): OFWebhookEvent | null;
}

/** Thrown by every provider implementation so callers never branch on HTTP. */
export class OnlyFansApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'OnlyFansApiError';
  }
}
