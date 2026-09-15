/**
 * Chat-agent notifications — recipients, delivery, and the two gates that stop
 * a notification repeating.
 *
 * This is the shared floor under the absence pipeline (`leaveCoverage.ts`,
 * `coverageNotices.ts`) and the salary surfaces (`/api/ca-salary/*`). Nothing
 * here authors copy: every message comes from `notificationContent.ts`
 * (notifications RULE 1) and every write goes through `addNotificationToBatch`
 * (RULE 2).
 *
 * ## The one hardcoded uid
 *
 * `CA_LEAVE_ALERT_RECIPIENT_UID` breaks the usual "iterate `groups/admin.members`,
 * never hardcode a uid" rule on purpose, the same way `OPS_ALERT_RECIPIENT_UID`
 * does for the OF Manager diagnostics. That rule exists to stop a notification
 * *meant for all admins* silently reaching one person whose id somebody typed.
 * These two are the opposite: leave requests and withdrawals are a single
 * person's queue, and fanning them out to every admin would be noise for
 * everyone who does not approve leave. There is exactly one definition —
 * **change it here when that responsibility moves**, and nowhere else.
 */

import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { addNotificationToBatch } from '../middleware/apiHelpers';
import { sendTelegramNotification } from './telegramService';
import type { NotificationContent } from '../notificationContent';
import type { SalaryMonthKey } from '../salary/salaryDate';

/** The one person who reviews leave. See the header note before changing it. */
export const CA_LEAVE_ALERT_RECIPIENT_UID = 'VoRCp0wmgvSgKG8yzxOyMyZ4cSv1';

const TIER_NOTICES = 'ca-salary-tier-notices';
const LATCHES = 'ca-notification-latches';

/**
 * Write one notification to each recipient and push the same content to
 * Telegram.
 *
 * **Never throws.** Every caller is a side effect hanging off an action that has
 * already succeeded — a leave request that was created, a month that was
 * finalised, an import that was written. Failing the request because a
 * notification could not be delivered would undo work the user can see, so the
 * outcome is returned and logged instead.
 *
 * Order matters and matches the rest of the app: commit the Firestore batch
 * first, attempt Telegram second (notifications.md § Telegram alerts).
 */
export async function notifyUsers(
  recipientUids: string[],
  content: NotificationContent,
  options: { docIdFor?: (uid: string) => string; label?: string } = {},
): Promise<{ delivered: number }> {
  const uids = [...new Set(recipientUids.filter(Boolean))];
  if (uids.length === 0) return { delivered: 0 };

  try {
    const batch = adminDb.batch();
    for (const uid of uids) {
      addNotificationToBatch(batch, uid, content, options.docIdFor ? { docId: options.docIdFor(uid) } : undefined);
    }
    await batch.commit();
  } catch (err) {
    console.error(`[caNotifications] failed to write ${options.label ?? 'notification'}`, err);
    return { delivered: 0 };
  }

  // `sendTelegramNotification` has its own never-throws contract; the try is
  // belt-and-braces so a future change there cannot break a caller.
  try {
    await sendTelegramNotification(uids, content);
  } catch (err) {
    console.error(`[caNotifications] Telegram push failed for ${options.label ?? 'notification'}`, err);
  }

  return { delivered: uids.length };
}

/**
 * Every chat agent — the CA group, minus archived users.
 *
 * Archived users are filtered rather than queried out: `isArchived` is absent on
 * most documents and an inequality filter on a missing field excludes exactly
 * the rows we want (rule 6). Same shape as `/api/ca-salary/roster`.
 */
export async function getChatAgentUids(): Promise<string[]> {
  const snap = await adminDb.collection('users').where('groups', 'array-contains', 'CA').get();
  return snap.docs
    .map(d => d.data())
    .filter(u => u.isArchived !== true && typeof u.uid === 'string')
    .map(u => u.uid as string);
}

/** "Cole", "Cole and Adam", "Cole, Adam and Liam" — the form a sentence needs. */
export function formatNameList(names: string[]): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

// ─── Once-per-thing gates ────────────────────────────────────────────

/**
 * Claim a one-shot latch, returning true only for the caller that got there
 * first.
 *
 * `create` is the whole mechanism: it fails if the document exists, so two cron
 * instances racing in the same minute cannot both send. Used for the monthly
 * payday reminder, whose trigger is a *date* rather than an action and would
 * otherwise fire on every tick of that day.
 */
export async function claimNotificationLatch(key: string, detail: Record<string, unknown> = {}): Promise<boolean> {
  try {
    await adminDb.collection(LATCHES).doc(key).create({
      key,
      claimedAt: FieldValue.serverTimestamp(),
      ...detail,
    });
    return true;
  } catch {
    // ALREADY_EXISTS — somebody else claimed it. Not an error condition.
    return false;
  }
}

/**
 * Tell an agent they have moved up a commission band — once per band, per month.
 *
 * The gate has to be stored because the trigger is a **change** and the salary
 * data is derived on read (ca-salary.md §1): recomputing the month tells you
 * what tier the agent is on, never what tier they were on when we last spoke.
 * `ca-salary-tier-notices/{uid}_{month}` is that memory, and nothing else reads
 * it.
 *
 * Only an *increase* notifies. A tier can legitimately fall — a large reversal
 * dated mid-month drags cumulative gross back down — and "you are now earning
 * less" is not a notification, it is a conversation with an admin. The stored
 * high-water mark is lowered anyway, so re-crossing the band notifies again.
 */
export async function syncCommissionTierNotice(params: {
  userId: string;
  month: SalaryMonthKey;
  currentPercent: number;
}): Promise<{ crossedTo: number | null }> {
  const { userId, month, currentPercent } = params;
  const ref = adminDb.collection(TIER_NOTICES).doc(`${userId}_${month}`);

  try {
    const snap = await ref.get();
    const lastPercent = snap.exists ? Number(snap.data()?.percent ?? 0) : null;

    // First sight of an agent-month is a baseline, not a promotion: everybody
    // starts the month on the lowest band, and announcing that would greet the
    // 1st of every month with "you are now earning 2.5%".
    if (lastPercent === null) {
      await ref.set({ userId, month, percent: currentPercent, updatedAt: FieldValue.serverTimestamp() });
      return { crossedTo: null };
    }

    if (currentPercent === lastPercent) return { crossedTo: null };

    await ref.set(
      { userId, month, percent: currentPercent, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return { crossedTo: currentPercent > lastPercent ? currentPercent : null };
  } catch (err) {
    console.error('[caNotifications] tier notice sync failed', err);
    return { crossedTo: null };
  }
}
