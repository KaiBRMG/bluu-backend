/**
 * Coalesced dispute-decision notifications.
 *
 * ## Why these are not sent inline
 *
 * A dispute is decided one row at a time, but they are *reviewed* in a sitting:
 * an assigned CA works down their queue, a team leader clears a week's backlog
 * in one pass. Every decision is its own `PATCH`, so sending inline messaged the
 * same agent once per dispute — six rejections in ninety seconds, six phone
 * buzzes, six Telegram pushes saying almost the same thing.
 *
 * So a decision does not notify. It **queues**, into one document per
 * `(stage, outcome, recipient)`, counting disputes and merging reasons as they
 * arrive. A quiet period later — nothing added for `QUIET_MS` — the queue is
 * flushed and each document becomes exactly one notification naming the count.
 *
 * ```
 *   reject #1 ─┐
 *   reject #2 ─┼─→ ca-dispute-notices/admin__rejected__{uid}  ──(quiet 3m)──→ 1 notification
 *   reject #3 ─┘        count: 3, reasons: [wrong creator, duplicate]
 * ```
 *
 * **Outcome is part of the key, never merged.** Approved and rejected are
 * different messages with different `type`s, and an agent who had two disputes
 * approved and one rejected must hear both facts — so they queue separately and
 * arrive as two notifications, not one blurred summary.
 *
 * **The flush is driven by cron** (`/api/cron/ca-notifications`, every 5
 * minutes), not by a timer inside the request — same reasoning as
 * `coverageNotices.ts`: a serverless function cannot be trusted to still exist
 * in three minutes' time, and a notification that silently never arrives is
 * worse than one that arrives eight minutes late.
 *
 * ## Read budget
 *
 * The collection holds only notices *waiting to be sent* — a flush deletes what
 * it sends — so it is empty almost all the time and the flush is an unfiltered
 * `.get()` over a handful of documents. Filtering on `updatedAt` would put a
 * queried field on the collection and buy an index for a scan of five rows
 * (rule 9). The cutoff is applied in memory.
 */

import { adminDb } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { notifications } from '../notificationContent';
import { formatNameList, notifyUsers } from './caNotifications';
// One definition of the quiet period for every coalesced CA message: they are
// flushed by the same cron tick and an agent should not have to learn two
// different delays.
import { QUIET_MS } from './coverageNotices';

const NOTICES = 'ca-dispute-notices';

/** Which approval step produced the decision. */
export type DisputeNoticeStage = 'ca' | 'admin';
export type DisputeNoticeOutcome = 'approved' | 'rejected';

interface DisputeNoticeDoc {
  noticeId: string;
  stage: DisputeNoticeStage;
  outcome: DisputeNoticeOutcome;
  userId: string;
  count: number;
  /** Who decided — only rendered for the CA stage, which names them. */
  actorNames: string[];
  /** Unique rejection reasons collected across the batch. */
  reasons: string[];
  updatedAt?: Timestamp;
}

function noticeId(stage: DisputeNoticeStage, outcome: DisputeNoticeOutcome, userId: string): string {
  return `${stage}__${outcome}__${userId}`;
}

/**
 * Add one decision to a user's pending notice, restarting the quiet period.
 *
 * Never throws: queuing is a side effect of an approval that has already been
 * written, and losing the message must not lose the decision.
 */
export async function queueDisputeNotice(params: {
  stage: DisputeNoticeStage;
  outcome: DisputeNoticeOutcome;
  /** The dispute's `createdBy` — the person being told. */
  userId: string;
  actorName?: string;
  reason?: string;
  /**
   * How many disputes this queues at once. A bulk decision passes the size of
   * the set rather than calling this once per dispute — same resulting message,
   * one write instead of N.
   */
  count?: number;
}): Promise<void> {
  const count = params.count ?? 1;
  if (!params.userId || count < 1) return;

  try {
    const id = noticeId(params.stage, params.outcome, params.userId);
    const reason = params.reason?.trim();
    const actorName = params.actorName?.trim();

    // `arrayUnion()` with no arguments throws, so an absent name or reason omits
    // the field entirely rather than merging an empty union.
    const payload: Record<string, unknown> = {
      noticeId: id,
      stage: params.stage,
      outcome: params.outcome,
      userId: params.userId,
      // `increment` rather than a read-modify-write: two reviewers clearing the
      // same agent's queue at once must not lose a dispute from the count.
      count: FieldValue.increment(count),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (actorName) payload.actorNames = FieldValue.arrayUnion(actorName);
    // arrayUnion de-duplicates, so ten disputes rejected for the same stated
    // reason produce one REASON clause, not ten copies.
    if (reason) payload.reasons = FieldValue.arrayUnion(reason);

    await adminDb.collection(NOTICES).doc(id).set(payload, { merge: true });
  } catch (err) {
    console.error('[disputeNotices] failed to queue', params.stage, params.outcome, err);
  }
}

export interface DisputeFlushReport {
  scanned: number;
  sent: number;
  waiting: number;
}

/**
 * Send every notice whose quiet period has elapsed, then delete it.
 *
 * Deleting is what makes the queue idempotent — there is no "sent" flag to fall
 * out of sync with reality, and a notice either exists (owed) or does not
 * (delivered). A notice is deleted even if delivery reported nothing, because
 * `notifyUsers` never throws and retrying forever would eventually spam the
 * agent for a failure that is not going to resolve itself.
 */
export async function flushDisputeNotices(now: number = Date.now()): Promise<DisputeFlushReport> {
  const snap = await adminDb.collection(NOTICES).get();
  const cutoff = now - QUIET_MS;

  let sent = 0;
  let waiting = 0;

  for (const doc of snap.docs) {
    const notice = doc.data() as DisputeNoticeDoc;
    const updatedAt = notice.updatedAt?.toMillis?.() ?? 0;

    // A server timestamp that has not resolved yet reads as 0; treat it as brand
    // new rather than infinitely old, or the notice flushes before the reviewer
    // has finished working down the queue.
    if (updatedAt === 0 || updatedAt > cutoff) {
      waiting += 1;
      continue;
    }

    // A merge write can only ever have set this to ≥ 1, but a floor of 1 keeps a
    // corrupt document from producing "0 of your disputes".
    const count = Math.max(1, Number(notice.count ?? 1));
    const reasons = notice.reasons ?? [];
    const actors = formatNameList(notice.actorNames ?? []) || 'Someone';

    const content =
      notice.stage === 'admin'
        ? notice.outcome === 'approved'
          ? notifications.disputeAdminApproved(count)
          : notifications.disputeAdminRejected(reasons, count)
        : notice.outcome === 'approved'
          ? notifications.disputeCaApproved(actors, count)
          : notifications.disputeCaRejected(actors, reasons, count);

    await notifyUsers([notice.userId], content, { label: `dispute ${notice.stage} ${notice.outcome}` });
    sent += 1;

    await doc.ref.delete();
  }

  return { scanned: snap.size, sent, waiting };
}
