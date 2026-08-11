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
  /** PPV price in USD; 0 for a free message. */
  price: number;
  /** True for a tip message. */
  isTip: boolean;
  /** For PPV: whether the fan has unlocked it. */
  isOpened: boolean;
  /** Number of attachments. Media itself is out of scope for this iteration. */
  mediaCount: number;
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

export interface SendMessageInput {
  text: string;
  /** Optional id of the message being replied to. */
  replyToMessageId?: string;
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
