/**
 * Commission-tier crossings after something moved a month's gross.
 *
 * Three things move gross for an agent: a BuddyX sales sync (new or changed
 * rows), an approved dispute (a sale transferred between two agents) and an
 * admin un-transfer. Each recomputes the agent-months it touched and asks
 * `syncCommissionTierNotice` — which owns the memory of what each agent was
 * last told, and the once-per-band, upwards-only gate — whether a band was
 * crossed. This used to live inside the `.xlsx` import route; it is shared now
 * that the import is not the only writer (ca-salary.md §11).
 *
 * **Never throws.** Every caller is a side effect of work that has already
 * committed; a failed notice is logged, not surfaced.
 */
import { notifications } from '../notificationContent';
import { formatMonthLabel, type SalaryMonthKey } from '../salary/salaryDate';
import { formatPercent } from '../salary/salaryFormat';
import { buildSalaryMonthForUsers } from './caSalaryService';
import { notifyUsers, syncCommissionTierNotice } from './caNotifications';

/** `uid|month` pairs → recompute and notify each agent who crossed upwards. */
export async function announceTierCrossings(pairs: Iterable<string>): Promise<number> {
  const byMonth = new Map<SalaryMonthKey, Set<string>>();
  for (const pair of pairs) {
    const [uid, month] = pair.split('|');
    if (!uid || !month) continue;
    const set = byMonth.get(month) ?? new Set<string>();
    set.add(uid);
    byMonth.set(month, set);
  }

  let sent = 0;
  for (const [month, uids] of byMonth) {
    try {
      const months = await buildSalaryMonthForUsers([...uids], month);
      const monthLabel = formatMonthLabel(month);
      for (const [userId, result] of months) {
        // A finalised month is frozen; nothing about it is news.
        if (result.status === 'finalized') continue;
        const { crossedTo } = await syncCommissionTierNotice({
          userId,
          month,
          currentPercent: result.tier.currentPercent,
        });
        if (crossedTo === null) continue;
        await notifyUsers([userId], notifications.commissionTierUp(formatPercent(crossedTo), monthLabel), {
          label: 'commissionTierUp',
        });
        sent += 1;
      }
    } catch (err) {
      console.error('[tierNotices] tier notification failed for', month, err);
    }
  }
  return sent;
}
