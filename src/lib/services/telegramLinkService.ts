/**
 * Account linking between a Bluu principal (an employee or a creator) and a
 * Telegram account.
 *
 * SERVER ONLY. Nothing here reads the bot token — delivery lives in
 * `telegramService.ts` — but it is the authority on *who a Telegram account is*,
 * which is the same class of decision as the login allowlist. Treat it that way.
 *
 * ── The data model ───────────────────────────────────────────────────────────
 *
 * Three pieces, mirroring the shapes auth.md already establishes for
 * `auth-emails` and `device-sessions`:
 *
 *  1. `telegram-links/{sha256(token)}` — a **one-time invite token**. The doc id
 *     is the *hash*, never the token: a link doc is readable by anyone with
 *     Admin SDK access (backups, an exported collection, a future admin screen),
 *     and a plaintext token there would be a live, replayable credential for
 *     someone else's account. Hashing costs nothing and removes the whole class.
 *
 *  2. `telegram-accounts/{telegramUserId}` — the **reverse index**, answering
 *     "which principal is this Telegram user?". Firestore cannot query a map key
 *     or ask that question off the principal doc, and the webhook has nothing
 *     but a Telegram id to go on. Exactly why `device-sessions` exists.
 *
 *  3. `telegram` on the principal doc (`users/{uid}` or `creators/{uid}`) — the
 *     **forward** direction, for rendering status and for resolving a chat id
 *     when notifying a known uid. Nothing queries it, so it is exempted from
 *     indexing in `firestore.indexes.json` (cross-cutting rule 9).
 *
 * Both directions are written in the same transaction. A half-written link is
 * the one state with no recovery path from the user's side: the token is spent,
 * so the link they were sent no longer works, and nothing on either doc says why.
 *
 * ── Why one live token per principal ─────────────────────────────────────────
 *
 * `telegramLinkTokenHash` on the principal doc points at the outstanding invite,
 * and minting a new one deletes the doc it replaces. That is what makes "the
 * admin generated a fresh link" actually invalidate the old one — a link that
 * was pasted into a chat months ago must not still bind an account today. It is
 * also an O(1) lookup rather than a query on `subjectUid`, which would need an
 * index for a field read exactly once (rule 9).
 */

import crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { invalidateUserCache } from '@/lib/services/userService';
import { buildTelegramStartLink } from '@/lib/telegramConfig';

/** Which collection a link belongs to. Employees and creators are separate
 *  identity spaces (see auth.md — never one uid with both docs). */
export type TelegramSubjectKind = 'user' | 'creator';

const COLLECTION_FOR: Record<TelegramSubjectKind, string> = {
  user: 'users',
  creator: 'creators',
};

const LINKS_COLLECTION = 'telegram-links';
const ACCOUNTS_COLLECTION = 'telegram-accounts';

/**
 * How long an invite stays usable. Long enough that a creator who is handed a
 * link on a Friday can still use it on Monday; short enough that a link sitting
 * in an old chat is not a standing key to an account.
 */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What the principal doc carries once linked. */
export interface TelegramBinding {
  /** Telegram's numeric user id, as a string. The stable identity. */
  userId: string;
  /** The private chat with the bot. For a private chat this equals `userId`,
   *  but it is stored rather than derived — Telegram does not promise that. */
  chatId: string;
  username: string | null;
  firstName: string | null;
  linkedAt: Timestamp;
}

/** Telegram's view of whoever sent `/start`. */
export interface TelegramSender {
  userId: string;
  chatId: string;
  username?: string | null;
  firstName?: string | null;
}

export type ConsumeResult =
  /** Bound. `displayName` is for the welcome message the caller then sends. */
  | { status: 'linked'; subjectKind: TelegramSubjectKind; subjectUid: string; displayName: string }
  /** Unknown, expired or already-spent token. Deliberately one status: a caller
   *  that could tell them apart could probe which tokens exist. */
  | { status: 'invalid' }
  /** This Telegram account is already bound to a *different* principal. */
  | { status: 'conflict' }
  /** The principal exists but is deactivated or archived. */
  | { status: 'inactive' };

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Mint a one-time link for a principal, invalidating any outstanding one.
 *
 * Returns the plaintext token exactly once — it is never recoverable afterwards,
 * because only its hash is stored. A caller that loses it mints a new one.
 */
export async function mintTelegramLinkToken(params: {
  subjectKind: TelegramSubjectKind;
  subjectUid: string;
  /** uid of the admin (or the user themselves) who generated it. Audit only. */
  createdBy: string;
}): Promise<{ token: string; url: string; expiresAt: Date }> {
  const { subjectKind, subjectUid, createdBy } = params;

  const subjectRef = adminDb.collection(COLLECTION_FOR[subjectKind]).doc(subjectUid);
  const subjectSnap = await subjectRef.get();
  if (!subjectSnap.exists) throw new Error('SUBJECT_NOT_FOUND');

  // 32 bytes → 43 base64url characters, inside Telegram's 64-character
  // `start` payload limit and its restricted alphabet. See telegramConfig.ts.
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const previousHash: unknown = subjectSnap.get('telegramLinkTokenHash');

  const batch = adminDb.batch();
  if (typeof previousHash === 'string' && previousHash && previousHash !== tokenHash) {
    batch.delete(adminDb.collection(LINKS_COLLECTION).doc(previousHash));
  }
  batch.set(adminDb.collection(LINKS_COLLECTION).doc(tokenHash), {
    subjectKind,
    subjectUid,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
    usedAt: null,
  });
  batch.update(subjectRef, {
    telegramLinkTokenHash: tokenHash,
    telegramLinkCreatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  if (subjectKind === 'user') invalidateUserCache(subjectUid);

  return { token, url: buildTelegramStartLink(token), expiresAt };
}

/**
 * Spend a token and bind the sender's Telegram account to the principal it names.
 *
 * All-or-nothing in one transaction, for the reason in the header comment. Never
 * throws on a *rejected* link — a bad token is an expected input from an
 * untrusted caller (the webhook), not an exception.
 */
export async function consumeTelegramLinkToken(
  token: string,
  sender: TelegramSender,
): Promise<ConsumeResult> {
  const tokenHash = hashToken(token);
  const linkRef = adminDb.collection(LINKS_COLLECTION).doc(tokenHash);
  const accountRef = adminDb.collection(ACCOUNTS_COLLECTION).doc(sender.userId);

  return adminDb.runTransaction(async (tx): Promise<ConsumeResult> => {
    // ── Reads first (Firestore requires it) ──────────────────────────────
    const [linkSnap, accountSnap] = await Promise.all([tx.get(linkRef), tx.get(accountRef)]);

    if (!linkSnap.exists) return { status: 'invalid' };
    const link = linkSnap.data() as {
      subjectKind: TelegramSubjectKind;
      subjectUid: string;
      expiresAt?: Timestamp;
      usedAt?: Timestamp | null;
    };
    if (link.usedAt) return { status: 'invalid' };
    if (link.expiresAt && link.expiresAt.toMillis() < Date.now()) return { status: 'invalid' };

    // Already this Telegram account's principal? Re-binding to the same one is
    // fine (a re-issued link, a chat cleared and restarted). A *different* one
    // is refused: one Telegram account must never address two identities, or a
    // notification's recipient stops being well defined.
    if (accountSnap.exists) {
      const existing = accountSnap.data() as { subjectUid?: string };
      if (existing.subjectUid && existing.subjectUid !== link.subjectUid) {
        return { status: 'conflict' };
      }
    }

    const subjectRef = adminDb.collection(COLLECTION_FOR[link.subjectKind]).doc(link.subjectUid);
    const subjectSnap = await tx.get(subjectRef);
    if (!subjectSnap.exists) return { status: 'invalid' };

    const subject = subjectSnap.data() as {
      displayName?: string;
      stageName?: string;
      isActive?: boolean;
      isArchived?: boolean;
      telegram?: TelegramBinding;
    };
    if (subject.isActive === false || subject.isArchived === true) return { status: 'inactive' };

    // The principal may already hold a *different* Telegram account (someone
    // changed accounts). Release the stale index entry or it keeps resolving to
    // this uid — the same failure `releaseAllDeviceSessions` exists to prevent.
    const previous = subject.telegram?.userId;

    // ── Writes ────────────────────────────────────────────────────────────
    if (previous && previous !== sender.userId) {
      tx.delete(adminDb.collection(ACCOUNTS_COLLECTION).doc(previous));
    }

    tx.set(accountRef, {
      subjectKind: link.subjectKind,
      subjectUid: link.subjectUid,
      chatId: sender.chatId,
      username: sender.username ?? null,
      linkedAt: FieldValue.serverTimestamp(),
    });

    tx.update(subjectRef, {
      telegram: {
        userId: sender.userId,
        chatId: sender.chatId,
        username: sender.username ?? null,
        firstName: sender.firstName ?? null,
        linkedAt: Timestamp.now(),
      },
      // The invite is spent; drop the pointer so status reads as "linked",
      // not "linked, with an outstanding invite".
      telegramLinkTokenHash: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(linkRef, { usedAt: FieldValue.serverTimestamp(), telegramUserId: sender.userId });

    const displayName =
      (link.subjectKind === 'creator' ? subject.stageName : subject.displayName) ||
      subject.displayName ||
      'there';

    return {
      status: 'linked',
      subjectKind: link.subjectKind,
      subjectUid: link.subjectUid,
      displayName,
    };
  }).then((result) => {
    // Outside the transaction on purpose: the cache is process-local, so
    // invalidating it before the commit lands would be a lie if the commit then
    // failed. Rule 2 — every user-doc write invalidates.
    if (result.status === 'linked' && result.subjectKind === 'user') {
      invalidateUserCache(result.subjectUid);
    }
    return result;
  });
}

/**
 * Remove a principal's Telegram binding, both directions.
 *
 * Idempotent — unlinking an unlinked principal is a no-op, not an error, because
 * the two surfaces that call this (Settings, admin) can both be clicked twice.
 * Any outstanding invite is torn down too: "disconnect" must not leave a live
 * link that silently reconnects the account.
 *
 * Returns the chat id it just released so the caller can clear that chat's menu
 * button. It is returned rather than acted on here because this file is the
 * Firestore half of linking and deliberately makes no Bot API calls — but a
 * disconnected creator who keeps a "Creator Portal" button keeps a shortcut into
 * a portal that will now refuse them, so the caller must not skip it.
 */
export async function unlinkTelegramAccount(
  subjectKind: TelegramSubjectKind,
  subjectUid: string,
): Promise<{ unlinked: boolean; chatId: string | null }> {
  const subjectRef = adminDb.collection(COLLECTION_FOR[subjectKind]).doc(subjectUid);
  const snap = await subjectRef.get();
  if (!snap.exists) return { unlinked: false, chatId: null };

  const telegramUserId: unknown = snap.get('telegram.userId');
  const pendingHash: unknown = snap.get('telegramLinkTokenHash');
  const chatIdValue: unknown = snap.get('telegram.chatId');

  const batch = adminDb.batch();
  if (typeof telegramUserId === 'string' && telegramUserId) {
    batch.delete(adminDb.collection(ACCOUNTS_COLLECTION).doc(telegramUserId));
  }
  if (typeof pendingHash === 'string' && pendingHash) {
    batch.delete(adminDb.collection(LINKS_COLLECTION).doc(pendingHash));
  }
  batch.update(subjectRef, {
    telegram: FieldValue.delete(),
    telegramLinkTokenHash: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  if (subjectKind === 'user') invalidateUserCache(subjectUid);

  return {
    unlinked: typeof telegramUserId === 'string' && !!telegramUserId,
    chatId: typeof chatIdValue === 'string' && chatIdValue ? chatIdValue : null,
  };
}

/**
 * Drop the index and invite documents for a principal whose own document is
 * already gone (or is about to be, in the same request).
 *
 * The delete cascade cannot call `unlinkTelegramAccount`: that reads the
 * principal doc to find the ids, and by then it has been deleted. So the caller
 * reads them off its own pre-delete snapshot and passes them in.
 *
 * Leaving these behind is not cosmetic. `telegram-accounts/{id}` is what
 * `lookupTelegramSubject` answers from, so a stale entry keeps resolving a
 * deleted employee's Telegram account to their old uid — the same failure mode
 * that makes `releaseAllDeviceSessions` part of the cascade (user-management.md).
 */
export async function releaseTelegramIndexEntries(params: {
  telegramUserId?: string | null;
  pendingTokenHash?: string | null;
}): Promise<void> {
  const { telegramUserId, pendingTokenHash } = params;
  if (!telegramUserId && !pendingTokenHash) return;

  const batch = adminDb.batch();
  if (telegramUserId) batch.delete(adminDb.collection(ACCOUNTS_COLLECTION).doc(telegramUserId));
  if (pendingTokenHash) batch.delete(adminDb.collection(LINKS_COLLECTION).doc(pendingTokenHash));
  await batch.commit();
}

/**
 * Which principal is this Telegram account? The Mini App's session exchange and
 * the webhook both need it.
 *
 * Re-checks the principal doc rather than trusting the index, for the same
 * reason `lookupDeviceOwner` does: a deactivated or archived principal must
 * resolve to `null`, and the index is not updated when they are deactivated.
 */
export async function lookupTelegramSubject(
  telegramUserId: string,
): Promise<{ subjectKind: TelegramSubjectKind; subjectUid: string } | null> {
  const snap = await adminDb.collection(ACCOUNTS_COLLECTION).doc(telegramUserId).get();
  if (!snap.exists) return null;

  const { subjectKind, subjectUid } = snap.data() as {
    subjectKind?: TelegramSubjectKind;
    subjectUid?: string;
  };
  if (!subjectKind || !subjectUid) return null;

  const subject = await adminDb.collection(COLLECTION_FOR[subjectKind]).doc(subjectUid).get();
  if (!subject.exists) return null;
  if (subject.get('isActive') === false || subject.get('isArchived') === true) return null;

  return { subjectKind, subjectUid };
}
