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
import { getOnlyFansClient, resolveAccountId, type OFChat, type OFMessage } from '@/lib/onlyfans';

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

  batch.set(chatRef.collection(OF_MESSAGES).doc(message.id), { ...message, createdAtMs });

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
