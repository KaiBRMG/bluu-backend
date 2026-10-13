/**
 * What approved leave does to pay. Pure, so the money rules are testable
 * without Firestore; `caSalaryService` resolves the inputs and calls these.
 *
 * Two rules, both applied **before** the engine runs:
 *
 * 1. **Sales inside a leave shift do not count** — paid or unpaid. The shift's
 *    accounts were released to someone else, so a sale BuddyX still attributes
 *    to the absent agent in that window is not theirs to earn on. Matched by
 *    the sale's own timestamp against the shift's window, not by salary day:
 *    an agent with leave on one shift may work another the same day.
 * 2. **Paid leave pays a normal day's wage.** Approval tombstones the shift, so
 *    there is nothing tracked to pay. Instead the day gets a synthetic shift of
 *    {@link PAID_LEAVE_HOURS} on the accounts the agent held the day before —
 *    or, when that was a day off or more leave, their most recent day with an
 *    assignment, within {@link PAID_LEAVE_ACCOUNT_LOOKBACK_DAYS}.
 */

import { PAID_LEAVE_ACCOUNT_LOOKBACK_DAYS, PAID_LEAVE_HOURS } from './salaryConstants';
import { addDays, toDayKey, type SalaryDayKey } from './salaryDate';
import { splitShiftAccounts } from './shiftAccounts';
import type { SalaryShiftInput } from './salaryTypes';

/** One approved leave request, resolved to the window its shift occupied. */
export interface LeaveWindow {
  leaveId: string;
  leaveType: 'paid' | 'unpaid';
  /** ms UTC. */
  start: number;
  /** ms UTC, exclusive. */
  end: number;
}

/** The leave window a moment falls in, if any. */
export function leaveAt(ms: number, windows: readonly LeaveWindow[]): LeaveWindow | null {
  for (const w of windows) {
    if (ms >= w.start && ms < w.end) return w;
  }
  return null;
}

/** The fields of a rostered occurrence that decide which accounts it paid on. */
export interface AssignedOccurrence {
  occurrenceStart: number;
  creatorIds?: string[] | null;
  overtimeCreatorIds?: string[] | null;
  paysWage?: boolean | null;
}

/**
 * The accounts an agent was paid on, per salary day — the engine's own count
 * (paying shifts only, in-shift overtime excluded), so a leave day is rated
 * from the same number the previous day's wage was.
 */
export function paidAccountsByDay(occurrences: readonly AssignedOccurrence[]): Map<SalaryDayKey, Set<string>> {
  const byDay = new Map<SalaryDayKey, Set<string>>();
  for (const o of occurrences) {
    if (o.paysWage === false) continue;
    const ids = splitShiftAccounts(o.creatorIds ?? [], o.overtimeCreatorIds ?? []).paidIds;
    if (ids.length === 0) continue;
    const day = toDayKey(o.occurrenceStart);
    const set = byDay.get(day) ?? new Set<string>();
    for (const id of ids) set.add(id);
    byDay.set(day, set);
  }
  return byDay;
}

/**
 * The synthetic shifts paid leave adds, by the day the leave's shift started.
 *
 * `accountsByDay` must reach {@link PAID_LEAVE_ACCOUNT_LOOKBACK_DAYS} before the
 * first leave day, which can be in the previous month.
 */
export function paidLeaveShifts(
  windows: readonly LeaveWindow[],
  accountsByDay: ReadonlyMap<SalaryDayKey, ReadonlySet<string>>,
): Map<SalaryDayKey, SalaryShiftInput[]> {
  const byDay = new Map<SalaryDayKey, SalaryShiftInput[]>();

  for (const w of windows) {
    if (w.leaveType !== 'paid') continue;
    const day = toDayKey(w.start);

    let basisDay: SalaryDayKey | null = null;
    let accounts: string[] = [];
    for (let back = 1; back <= PAID_LEAVE_ACCOUNT_LOOKBACK_DAYS; back++) {
      const candidate = addDays(day, -back);
      const held = accountsByDay.get(candidate);
      if (held && held.size > 0) {
        basisDay = candidate;
        accounts = [...held];
        break;
      }
    }

    const input: SalaryShiftInput = {
      shiftId: `leave:${w.leaveId}`,
      occurrenceStart: w.start,
      scheduledHours: PAID_LEAVE_HOURS,
      trackedSeconds: 0,
      creatorIds: accounts,
      overtimeCreatorIds: [],
      isOvertime: false,
      paysWage: true,
      paidLeave: true,
      paidLeaveBasisDay: basisDay,
    };
    const list = byDay.get(day);
    if (list) list.push(input);
    else byDay.set(day, [input]);
  }

  return byDay;
}
