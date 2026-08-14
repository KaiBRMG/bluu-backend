/**
 * OnlyFans CRM server service — access gate, the Firestore chat mirror, and
 * webhook ingest.
 *
 * Two cost budgets shape everything here:
 *
 *  1. **Provider credits.** Every OnlyFans call is billed, so the chat list is
 *     mirrored into Firestore and kept fresh by *webhooks*, not polling. A pull
 *     from the provider happens only on an explicit sync, and a sync is rate
 *     limited cross-instance (`onlyfans-meta/{accountId}.chatsSyncedAt`).
 *  2. **Firestore writes.** The mirror is diffed before writing — an unchanged
 *     chat row costs nothing. Message *history* is deliberately NOT mirrored
 *     (it would be thousands of writes per thread); only live messages that
 *     arrive while the app is open land in the `messages` subcollection, so the
 *     open thread can update in realtime. History is paged from the provider on
 *     demand and cached client-side.
 *
 * See documentation/onlyfans-crm.md.
 */
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import {
  getOnlyFansClient,
  resolveAccountId,
  type OFChat,
  type OFMessage,
  type OFMessagePage,
  type OFVaultList,
  type OFVaultPage,
  type ResolvedMedia,
  type VaultQuery,
} from '@/lib/onlyfans';

/** Page permission that gates every OnlyFans surface. */
export const OF_PAGE_ID = 'apps-ofmanager';

export const OF_CHATS = 'onlyfans-chats';
export const OF_MESSAGES = 'messages';
export const OF_META = 'onlyfans-meta';

/** How long a chat-list sync is considered fresh. Webhooks cover the gap. */
const CHAT_SYNC_TTL_MS = 60 * 1000;

/** How many live messages we keep per chat. The rest is paged from the provider. */
export const LIVE_MESSAGE_LIMIT = 50;

// ─── Authorization ──────────────────────────────────────────────────

/**
 * Tier-2 gate for every OnlyFans route. Returns a 403 response when denied,
 * null when allowed — same contract as `checkPageAccess`.
 */
export function requireOnlyFansAccess(uid: string): Promise<NextResponse | null> {
  return checkPageAccess(uid, OF_PAGE_ID);
}

// ─── Document ids ───────────────────────────────────────────────────

/**
 * Chat docs are keyed by account + chat so a second linked account can never
 * collide with the first. `__` is not valid in either id.
 */
export function chatDocId(accountId: string, chatId: string): string {
  return `${accountId}__${chatId}`;
}

// ─── Serialization ──────────────────────────────────────────────────

/** The mirrored shape of a chat row. Kept flat so the client reads it as-is. */
export interface OFChatDoc extends OFChat {
  accountId: string;
  /** Epoch ms mirror of `lastMessageAt` — what the list orders by. */
  lastMessageAtMs: number;
  updatedAt: number;
}

function toChatDoc(accountId: string, chat: OFChat): OFChatDoc {
  return {
    ...chat,
    accountId,
    lastMessageAtMs: chat.lastMessageAt ? Date.parse(chat.lastMessageAt) : 0,
    updatedAt: Date.now(),
  };
}

/**
 * Has anything a user can see changed? Compared before writing so a sync over
 * an idle inbox costs zero writes.
 */
function chatChanged(existing: Partial<OFChatDoc> | undefined, next: OFChatDoc): boolean {
  if (!existing) return true;
  return (
    existing.lastMessageId !== next.lastMessageId ||
    existing.lastMessageText !== next.lastMessageText ||
    existing.unreadCount !== next.unreadCount ||
    existing.spentTotal !== next.spentTotal ||
    existing.isPinned !== next.isPinned ||
    existing.fan?.name !== next.fan.name ||
    existing.fan?.avatar !== next.fan.avatar
  );
}

// ─── Chat list sync ─────────────────────────────────────────────────

export interface SyncChatsResult {
  accountId: string;
  /** False when the mirror was already fresh and no provider call was made. */
  synced: boolean;
  /** Offset for the next page of older chats, or null when exhausted. */
  nextOffset: number | null;
}

/** Per-instance guard so concurrent requests in one lambda collapse into one sync. */
let inFlightSync: Promise<SyncChatsResult> | null = null;
let lastSyncAtMs = 0;

/**
 * Pull the chat list from the provider and reconcile the Firestore mirror.
 *
 * The first page is rate limited on two levels: an in-process timestamp (free)
 * and a Firestore meta doc (authoritative across serverless instances). `force`
 * bypasses both — only ever from an explicit user action.
 *
 * `offset > 0` is the "load older chats" path: always a real pull (the user
 * asked for rows the mirror does not have) and it leaves the freshness marker
 * alone, since it says nothing about the top of the inbox.
 */
export async function syncChats(
  opts: { force?: boolean; limit?: number; offset?: number } = {},
): Promise<SyncChatsResult> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  if (offset > 0) {
    const accountId = await resolveAccountId();
    const page = await getOnlyFansClient().listChats(accountId, { limit, offset });
    await writeChatMirror(accountId, page.chats);
    return { accountId, synced: true, nextOffset: page.nextOffset };
  }

  if (inFlightSync) return inFlightSync;

  inFlightSync = (async () => {
    const accountId = await resolveAccountId();

    if (!opts.force) {
      if (Date.now() - lastSyncAtMs < CHAT_SYNC_TTL_MS) {
        return { accountId, synced: false, nextOffset: limit };
      }

      const metaSnap = await adminDb.collection(OF_META).doc(accountId).get();
      const syncedAt = (metaSnap.data()?.chatsSyncedAt as number | undefined) ?? 0;
      if (Date.now() - syncedAt < CHAT_SYNC_TTL_MS) {
        lastSyncAtMs = syncedAt;
        return { accountId, synced: false, nextOffset: limit };
      }
    }

    const page = await getOnlyFansClient().listChats(accountId, { limit });
    await writeChatMirror(accountId, page.chats);

    lastSyncAtMs = Date.now();
    await adminDb
      .collection(OF_META)
      .doc(accountId)
      .set({ chatsSyncedAt: lastSyncAtMs }, { merge: true });

    return { accountId, synced: true, nextOffset: page.nextOffset };
  })();

  try {
    return await inFlightSync;
  } finally {
    inFlightSync = null;
  }
}

/** Diff-then-write the mirror. Unchanged rows are skipped entirely. */
async function writeChatMirror(accountId: string, chats: OFChat[]): Promise<void> {
  if (chats.length === 0) return;

  const refs = chats.map((c) => adminDb.collection(OF_CHATS).doc(chatDocId(accountId, c.id)));
  const existing = await adminDb.getAll(...refs);

  const batch = adminDb.batch();
  let writes = 0;
  chats.forEach((chat, i) => {
    const next = toChatDoc(accountId, chat);
    if (!chatChanged(existing[i].data() as OFChatDoc | undefined, next)) return;
    batch.set(refs[i], next, { merge: true });
    writes += 1;
  });

  if (writes > 0) await batch.commit();
}

// ─── Message history ────────────────────────────────────────────────

/**
 * How long a fetched history page is reused. Short on purpose: it exists to
 * collapse the *burst* of identical reads that a thread open produces (the
 * operator flicking back to a chat, two operators in the same inbox, a re-mount
 * after a window resize), not to serve stale conversation.
 *
 * It is safe at any duration because the page is only ever half the thread — the
 * live tail is an `onSnapshot` on Firestore and is always current, so a cached
 * page can lag without the operator seeing a stale conversation.
 */
const MESSAGE_PAGE_TTL_MS = 20 * 1000;
const MESSAGE_PAGE_MAX = 200;

const messagePages = new Map<string, { page: OFMessagePage; expiresAt: number }>();
/** Concurrent identical requests collapse into one provider call. */
const messagePagesInFlight = new Map<string, Promise<OFMessagePage>>();

/**
 * A page of history, memoised per server instance.
 *
 * Every provider call is billed and each one is the slowest thing in a thread
 * open, so two operators opening the same chat — or one operator opening it
 * twice — must not pay twice. `force` is the explicit-refresh path and bypasses
 * both the memo and the in-flight join.
 */
export async function listMessagePage(
  accountId: string,
  chatId: string,
  opts: { limit?: number; cursor?: string; force?: boolean } = {},
): Promise<OFMessagePage> {
  const key = `${accountId} ${chatId} ${opts.limit ?? ''} ${opts.cursor ?? 'head'}`;

  if (!opts.force) {
    const hit = messagePages.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.page;

    const pending = messagePagesInFlight.get(key);
    if (pending) return pending;
  }

  const request = getOnlyFansClient()
    .listMessages(accountId, chatId, { limit: opts.limit, cursor: opts.cursor })
    .then((page) => {
      if (messagePages.size >= MESSAGE_PAGE_MAX) {
        const oldest = messagePages.keys().next().value;
        if (oldest !== undefined) messagePages.delete(oldest);
      }
      messagePages.set(key, { page, expiresAt: Date.now() + MESSAGE_PAGE_TTL_MS });
      return page;
    })
    .finally(() => {
      messagePagesInFlight.delete(key);
    });

  messagePagesInFlight.set(key, request);
  return request;
}

/**
 * Drop any memoised head page for a chat.
 *
 * Called after a send: the operator's own message must not be missing from the
 * page they get back a moment later just because the memo predates it.
 */
function invalidateMessagePages(accountId: string, chatId: string): void {
  const prefix = `${accountId} ${chatId} `;
  for (const key of messagePages.keys()) {
    if (key.startsWith(prefix)) messagePages.delete(key);
  }
}

// ─── Vault ──────────────────────────────────────────────────────────

/**
 * Vault categories change about never and every listing is billed, so this is
 * the longest-lived memo in the service. The dialog opens far more often than
 * the creator makes a folder.
 */
const VAULT_LISTS_TTL_MS = 30 * 60 * 1000;
/**
 * Vault *media* is short because the operator uploading a file expects to find
 * it in the vault a moment later. Long enough to collapse the burst of paging
 * one dialog session produces, short enough not to hide a new upload.
 */
const VAULT_MEDIA_TTL_MS = 60 * 1000;
const VAULT_MEDIA_MAX = 60;

const vaultLists = new Map<string, { lists: OFVaultList[]; expiresAt: number }>();
const vaultMedia = new Map<string, { page: OFVaultPage; expiresAt: number }>();
/** Concurrent identical requests collapse into one provider call, as with history. */
const vaultInFlight = new Map<string, Promise<OFVaultPage>>();

export async function listVaultListsCached(accountId: string): Promise<OFVaultList[]> {
  const hit = vaultLists.get(accountId);
  if (hit && hit.expiresAt > Date.now()) return hit.lists;

  const lists = await getOnlyFansClient().listVaultLists(accountId);
  vaultLists.set(accountId, { lists, expiresAt: Date.now() + VAULT_LISTS_TTL_MS });
  return lists;
}

export async function listVaultMediaCached(
  accountId: string,
  query: VaultQuery,
): Promise<OFVaultPage> {
  const key = [
    accountId,
    query.listId ?? '',
    query.type ?? '',
    query.query ?? '',
    query.limit ?? '',
    query.offset ?? 0,
  ].join(' ');

  const hit = vaultMedia.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.page;

  const pending = vaultInFlight.get(key);
  if (pending) return pending;

  const request = getOnlyFansClient()
    .listVaultMedia(accountId, query)
    .then((page) => {
      if (vaultMedia.size >= VAULT_MEDIA_MAX) {
        const oldest = vaultMedia.keys().next().value;
        if (oldest !== undefined) vaultMedia.delete(oldest);
      }
      vaultMedia.set(key, { page, expiresAt: Date.now() + VAULT_MEDIA_TTL_MS });
      return page;
    })
    .finally(() => {
      vaultInFlight.delete(key);
    });

  vaultInFlight.set(key, request);
  return request;
}

// ─── Media ──────────────────────────────────────────────────────────

/**
 * Blank every CDN link on a message before it is written to Firestore.
 *
 * Provider media URLs are signed, IP-locked and good for about a minute — they
 * are stale before the write lands, and a mirrored copy is a link that will
 * never work again while still looking like data. The **metadata** (id, type,
 * dimensions, duration, DRM-or-not, locked-or-not) is durable and is what the
 * UI needs to lay a tile out; the URL is resolved on demand at render time.
 */
export function stripMediaUrls(message: OFMessage): OFMessage {
  if (message.attachments.length === 0) return message;
  return {
    ...message,
    attachments: message.attachments.map((a) => ({
      ...a,
      urls: { full: null, preview: null, thumb: null },
    })),
  };
}

/**
 * Resolve a media URL, collapsing repeats within this server instance.
 *
 * Resolving media the provider has not cached is **billed**, and a thread the
 * operator scrolls back over asks for the same tiles again. A short in-process
 * memo makes those repeats free. It is deliberately not Firestore-backed: the
 * answer is worth less than a minute, so a persisted copy would cost a read to
 * return something already expired.
 */
const resolvedMedia = new Map<string, { url: string; expiresAt: number }>();
/** Bounds the memo. Media URLs are long; an unbounded map is a slow leak. */
const RESOLVED_MEDIA_MAX = 500;

export async function resolveMediaUrlCached(
  accountId: string,
  cdnUrl: string,
): Promise<ResolvedMedia> {
  const key = `${accountId} ${cdnUrl}`;
  const now = Date.now();

  const hit = resolvedMedia.get(key);
  if (hit && hit.expiresAt > now) {
    return { url: hit.url, ttlMs: hit.expiresAt - now };
  }

  const resolved = await getOnlyFansClient().resolveMediaUrl(accountId, cdnUrl);

  if (resolvedMedia.size >= RESOLVED_MEDIA_MAX) {
    // Insertion-ordered, so the oldest entry is the first key.
    const oldest = resolvedMedia.keys().next().value;
    if (oldest !== undefined) resolvedMedia.delete(oldest);
  }
  resolvedMedia.set(key, { url: resolved.url, expiresAt: now + resolved.ttlMs });

  return resolved;
}

// ─── Live messages ──────────────────────────────────────────────────

/**
 * Record a message that arrived (or was sent) while the app is running, so any
 * operator with the thread open sees it without another provider call.
 *
 * Idempotent on message id — the send path and the `messages.sent` webhook both
 * land here for the same message.
 */
export async function recordLiveMessage(
  accountId: string,
  message: OFMessage,
  opts: { unread?: 'increment' | 'reset' } = {},
): Promise<void> {
  const chatRef = adminDb.collection(OF_CHATS).doc(chatDocId(accountId, message.chatId));
  const createdAtMs = Date.parse(message.createdAt) || Date.now();
  const batch = adminDb.batch();

  // A memoised page that predates this message would hide it from the next
  // history fetch for up to the memo's TTL.
  invalidateMessagePages(accountId, message.chatId);

  batch.set(chatRef.collection(OF_MESSAGES).doc(message.id), {
    ...stripMediaUrls(message),
    createdAtMs,
  });

  // The chat row must move to the top of the list even if it was never synced,
  // so this is a merge-set (creating the doc) rather than an update.
  batch.set(
    chatRef,
    {
      accountId,
      id: message.chatId,
      lastMessageId: message.id,
      lastMessageText: message.text,
      lastMessageAt: message.createdAt,
      lastMessageAtMs: createdAtMs,
      lastMessageFromMe: message.fromMe,
      updatedAt: Date.now(),
      // FieldValue.increment keeps this a single blind write — a read-modify-write
      // transaction here would cost a Firestore read on every inbound message.
      ...(opts.unread === 'increment' ? { unreadCount: FieldValue.increment(1) } : {}),
      ...(opts.unread === 'reset' ? { unreadCount: 0 } : {}),
    },
    { merge: true },
  );

  await batch.commit();
}

/** Clear the unread badge on the mirror after a successful provider mark-as-read. */
export async function clearUnread(accountId: string, chatId: string): Promise<void> {
  await adminDb
    .collection(OF_CHATS)
    .doc(chatDocId(accountId, chatId))
    .set({ unreadCount: 0, updatedAt: Date.now() }, { merge: true });
}
