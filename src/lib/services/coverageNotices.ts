/**
 * Coalesced coverage notifications, and the record of a withdrawn absence.
 *
 * ## Why these are not sent inline
 *
 * One absence releases *every* creator the agent was covering, and an admin
 * assigns them one at a time down the board. Sending on each assignment would
 * message the same person four times in ninety seconds — the exact thing the
 * brief rules out. The same is true in reverse when the agent withdraws their
 * leave: one withdrawal cancels every offer it created at once.
 *
 * So an assignment does not notify. It **queues**, into one document per
 * `(kind, agent, day)`, merging creator names as they arrive. A quiet period
 * later — nothing added for `QUIET_MS` — the queue is flushed and each document
 * becomes exactly one notification naming every creator it collected.
 *
 * ```
 *   assign Cole  ─┐
 *   assign Adam  ─┼─→ ca-coverage-notices/assigned__{uid}__{day}  ──(quiet 3m)──→ 1 notification
 *   assign Liam  ─┘        creatorNames: [Cole, Adam, Liam]
 * ```
 *
 * **The flush is driven by cron** (`/api/cron/ca-notifications`, every 5
 * minutes), not by a timer inside the request. A serverless function cannot be
 * trusted to still exist in three minutes' time, and a notification that
 * silently never arrives is worse than one that arrives eight minutes late.
 *
 * ## Read budget
 *
 * The collection holds only notices *waiting to be sent* — a flush deletes what
 * it sends — so it is empty almost all the time and the flush is an unfiltered
 * `.get()` over a handful of documents. That is deliberate: filtering on
 * `updatedAt` would put a queried field on the collection and buy an index for a
 * scan of five rows (rule 9). The cutoff is applied in memory.
 */

import { adminDb } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { notifications } from '../notificationContent';
import { formatDayLabelWithWeekday, toDayKey, type SalaryDayKey } from '../salary/salaryDate';
import { resolveAccountNames } from './creatorAccountService';
import { formatNameList, notifyUsers } from './caNotifications';

const NOTICES = 'ca-coverage-notices';
const WITHDRAWALS = 'ca-coverage-withdrawals';

/**
 * How long a queue must sit untouched before it is sent.
 *
 * Long enough to cover an admin working down a board of four accounts; short
 * enough that an agent finds out about tomorrow's overtime today. The cron runs
 * every 5 minutes, so worst-case delivery is roughly 8 minutes after the last
 * assignment.
 */
export const QUIET_MS = 3 * 60 * 1000;

export type CoverageNoticeKind = 'assigned' | 'cancelled';

interface CoverageNoticeDoc {
  noticeId: string;
  kind: CoverageNoticeKind;
  userId: string;
  day: SalaryDayKey;
  creatorNames: string[];
  updatedAt?: Timestamp;
}

function noticeId(kind: CoverageNoticeKind, userId: string, day: SalaryDayKey): string {
  return `${kind}__${userId}__${day}`;
}

/**
 * Add one creator to an agent's pending notice for a day, restarting the quiet
 * period.
 *
 * Never throws: queuing is a side effect of an assignment that has already been
 * written, and losing the message must not lose the assignment.
 */
export async function queueCoverageNotice(params: {
  kind: CoverageNoticeKind;
  userId: string;
  day: SalaryDayKey;
  creatorNames: string[];
}): Promise<void> {
  const names = [...new Set(params.creatorNames.filter(Boolean))];
  if (names.length === 0) return;

  try {
    const id = noticeId(params.kind, params.userId, params.day);
    await adminDb
      .collection(NOTICES)
      .doc(id)
      .set(
        {
          noticeId: id,
          kind: params.kind,
          userId: params.userId,
          day: params.day,
          // arrayUnion so two admins assigning at once cannot drop each other's
          // creator, and so a re-assignment of the same account does not list it
          // twice.
          creatorNames: FieldValue.arrayUnion(...names),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (err) {
    console.error('[coverageNotices] failed to queue', params.kind, err);
  }
}

/**
 * Queue the "Overtime Assigned" notice for accounts marked overtime **on a
 * shift**, in Shift Management.
 *
 * The other door to the same fact. `POST /api/ca-coverage/assign` queues this
 * notice when an admin assigns from the Coverage board; an admin who instead
 * marks accounts Overtime on the shift itself was assigning overtime just the
 * same, and the agent was never told — they found out by looking at their
 * calendar, if they looked.
 *
 * It goes through the *same* coalescing queue rather than sending inline, which
 * matters more here than on the board: one save can mark several accounts at
 * once, and an admin correcting a roster may save the same shift twice in a
 * minute. `(kind, agent, day)` absorbs all of it into one message.
 *
 * **Pass only the accounts that are newly overtime.** The caller diffs against
 * what the shift already had, because re-sending on an unrelated edit (moving
 * the shift by an hour) is how a useful notification becomes one people mute.
 *
 * Never throws. The shift is already written and the admin must not be told the
 * save failed because a message could not be queued.
 */
export async function queueOvertimeAssignedForShift(params: {
  userId: string;
  /** Any instant inside the day the overtime falls on — bucketed to the salary day. */
  occurrenceMs: number;
  /** The accounts that became overtime in this write. Empty is a no-op. */
  addedCreatorIds: string[];
}): Promise<void> {
  if (params.addedCreatorIds.length === 0) return;

  try {
    const names = await resolveAccountNames(params.addedCreatorIds);
    await queueCoverageNotice({
      kind: 'assigned',
      userId: params.userId,
      day: toDayKey(params.occurrenceMs),
      // `resolveAccountNames` falls back to the id, so a deleted account still
      // produces a message. Better a message naming something odd than silence
      // about work somebody is expected to do.
      creatorNames: params.addedCreatorIds.map(id => names.get(id) ?? id),
    });
  } catch (err) {
    console.error('[coverageNotices] failed to queue shift overtime', err);
  }
}

export interface FlushReport {
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
export async function flushCoverageNotices(now: number = Date.now()): Promise<FlushReport> {
  const snap = await adminDb.collection(NOTICES).get();
  const cutoff = now - QUIET_MS;

  let sent = 0;
  let waiting = 0;

  for (const doc of snap.docs) {
    const notice = doc.data() as CoverageNoticeDoc;
    const updatedAt = notice.updatedAt?.toMillis?.() ?? 0;

    // A server timestamp that has not resolved yet reads as 0; treat it as brand
    // new rather than infinitely old, or the notice flushes before the admin has
    // finished assigning.
    if (updatedAt === 0 || updatedAt > cutoff) {
      waiting += 1;
      continue;
    }

    const creatorList = formatNameList(notice.creatorNames ?? []);
    if (creatorList) {
      const dateStr = formatDayLabelWithWeekday(notice.day);
      const content =
        notice.kind === 'assigned'
          ? notifications.overtimeAssigned(creatorList, dateStr)
          : notifications.overtimeCancelled(creatorList, dateStr);

      await notifyUsers([notice.userId], content, { label: `coverage ${notice.kind}` });
      sent += 1;
    }

    await doc.ref.delete();
  }

  return { scanned: snap.size, sent, waiting };
}

// ─── The withdrawal record (the Coverage tab's indicator) ────────────

export interface LeaveWithdrawalRecord {
  leaveId: string;
  userId: string;
  displayName: string;
  day: SalaryDayKey;
  leaveType: 'paid' | 'unpaid';
  /** Accounts that were on the board for this absence. */
  creatorNames: string[];
  /** Agents whose assigned overtime was taken back, with what they lost. */
  reverted: Array<{ userId: string; displayName: string; creatorNames: string[] }>;
  /** True when the agent's original shift occurrence came back. */
  shiftRestored: boolean;
  withdrawnAt: string | null;
}

/**
 * Record a withdrawn absence so the Coverage tab can say it happened.
 *
 * Offers vanish when a withdrawal reverts them, which is correct — they are no
 * longer work anyone needs to do — but it leaves an admin who saw four accounts
 * on the board yesterday with no explanation of where they went. This is that
 * explanation, and it is the only thing that reads the collection.
 *
 * Keyed by `leaveId`, so withdrawing the same leave twice cannot produce two
 * rows.
 */
export async function recordLeaveWithdrawal(record: Omit<LeaveWithdrawalRecord, 'withdrawnAt'>): Promise<void> {
  try {
    await adminDb
      .collection(WITHDRAWALS)
      .doc(record.leaveId)
      .set({ ...record, withdrawnAt: FieldValue.serverTimestamp() });
  } catch (err) {
    console.error('[coverageNotices] failed to record withdrawal', err);
  }
}

/** Recent withdrawals, newest first — the strip above the Coverage queues. */
export async function getRecentLeaveWithdrawals(limit = 10): Promise<LeaveWithdrawalRecord[]> {
  const snap = await adminDb
    .collection(WITHDRAWALS)
    .orderBy('withdrawnAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map(doc => {
    const data = doc.data() as LeaveWithdrawalRecord & { withdrawnAt?: Timestamp };
    return {
      leaveId: data.leaveId,
      userId: data.userId,
      displayName: data.displayName,
      day: data.day,
      leaveType: data.leaveType,
      creatorNames: data.creatorNames ?? [],
      reverted: data.reverted ?? [],
      shiftRestored: data.shiftRestored ?? false,
      withdrawnAt: data.withdrawnAt?.toDate?.()?.toISOString() ?? null,
    };
  });
}
