/**
 * Leave balances: the allotments, the defaults, and the reset periods.
 *
 * One module because the same three numbers were previously spelled out at six
 * call sites and **two of them disagreed**. `AdminLeave` and `UserDetailContent`
 * read a missing balance as `4` / `10`; the request route, `LeaveBalanceCard`
 * and `RequestLeaveDialog` read the same missing field as `0`. Since nothing
 * seeded the fields at user creation, that was the normal state of a new agent:
 * an admin saw four unpaid days, the agent saw "0 unpaid days left" and was
 * refused by the API. Neither side was wrong about the number it had — there was
 * no number.
 *
 * So: `resolveLeaveBalances` is the only way to read a balance off a user
 * document, and the allotment constants below are the only place the entitlement
 * is written down.
 *
 * ## The entitlement
 *
 * - **Unpaid leave: 4 days, resetting on the 1st of every month.**
 * - **Paid leave: 10 days, resetting on 1 January**, and only for users with
 *   `hasPaidLeave`.
 *
 * Balances do not carry over. A reset is an assignment to the allotment, not an
 * increment, so an unused month does not compound into a fortnight.
 *
 * ## The day boundary is Africa/Harare, deliberately
 *
 * A leave month has to start when the salary month starts, or an agent can take
 * a day off that lands in September's roster and spends October's balance. The
 * period keys therefore come from [`salaryDate.ts`](../salary/salaryDate.ts),
 * whose fixed-offset arithmetic is only correct because that zone has no DST
 * (CLAUDE.md rule 9f). Do not swap these for `Intl` on the viewer's timezone:
 * the entitlement is a company fact, not a local one, and an agent in Manila
 * must not get their reset sixteen hours before an agent in Cape Town.
 */

import { currentMonthKey, monthOfDay, currentDayKey } from '@/lib/salary/salaryDate';
import type { UserDocument } from '@/types/firestore';

/** Unpaid days granted on the 1st of each month. */
export const UNPAID_LEAVE_DAYS_PER_MONTH = 4;

/** Paid days granted on 1 January, for users with `hasPaidLeave`. */
export const PAID_LEAVE_DAYS_PER_YEAR = 10;

export type LeaveType = 'paid' | 'unpaid';

/** The user-document field each leave type spends. */
export const LEAVE_BALANCE_FIELD: Record<LeaveType, 'remainingPaidLeave' | 'remainingUnpaidLeave'> = {
  paid: 'remainingPaidLeave',
  unpaid: 'remainingUnpaidLeave',
};

/** The full allotment for a leave type — the ceiling a refund may not exceed. */
export const LEAVE_ALLOTMENT: Record<LeaveType, number> = {
  paid: PAID_LEAVE_DAYS_PER_YEAR,
  unpaid: UNPAID_LEAVE_DAYS_PER_MONTH,
};

/**
 * The reset periods the given instant falls in.
 *
 * `month` is the unpaid period (`YYYY-MM`); `year` is the paid one. Both are
 * salary-calendar values, so they change at 00:00 Africa/Harare.
 */
export function leaveResetPeriods(now: number = Date.now()): { month: string; year: number } {
  const month = currentMonthKey(now);
  return { month, year: Number(month.slice(0, 4)) };
}

/** The unpaid-leave period a given day key belongs to. */
export function unpaidPeriodOfDay(day: string): string {
  return monthOfDay(day);
}

/** The unpaid-leave period the current salary day belongs to. */
export function currentUnpaidPeriod(now: number = Date.now()): string {
  return unpaidPeriodOfDay(currentDayKey(now));
}

/**
 * What a user document actually says about leave, with the defaults applied once.
 *
 * Accepts a partial because every caller has a different shape of the same
 * document — the Admin SDK's `DocumentData`, the client's `UserDocument`, the
 * admin list row. All three only ever need these three fields.
 *
 * **`hasPaidLeave` gates the paid number, and the number is never the gate.**
 * `paid` is reported as `0` for a user without the entitlement even if the field
 * holds `10`, because a stale `10` on a user whose paid leave was switched off
 * is exactly how someone gets told they have ten days they cannot take. That was
 * a real bug in the request dialog; this is the fix, kept in one place.
 */
export function resolveLeaveBalances(
  user: Pick<UserDocument, 'hasPaidLeave' | 'remainingUnpaidLeave' | 'remainingPaidLeave'> | null | undefined,
): { unpaid: number; paid: number; hasPaidLeave: boolean } {
  const hasPaidLeave = user?.hasPaidLeave === true;
  return {
    unpaid: clampDays(user?.remainingUnpaidLeave, UNPAID_LEAVE_DAYS_PER_MONTH),
    paid: hasPaidLeave ? clampDays(user?.remainingPaidLeave, PAID_LEAVE_DAYS_PER_YEAR) : 0,
    hasPaidLeave,
  };
}

/**
 * A stored balance, or the allotment when nothing is stored.
 *
 * A *stored* value is trusted as-is above the allotment — an admin may
 * deliberately grant someone extra days in CA Admin → Leave, and silently
 * capping that would make the field lie about what was typed into it. Only the
 * floor is enforced, because a negative balance is never an instruction.
 */
function clampDays(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/**
 * The balance updates a user needs to bring them into the current period, or
 * `null` when they are already current.
 *
 * Pure, so the cron that calls it per user is testable without Firestore, and so
 * the "did anything change" decision is made before a write rather than by one.
 *
 * ## Why a stored marker rather than "it is the 1st, so reset"
 *
 * A date check resets whoever happens to be processed while the clock says the
 * 1st, which makes correctness depend on the cron firing — a missed run silently
 * skips a month, and a double run double-resets. The marker makes the job
 * **idempotent and self-healing**: re-running it the same day is a no-op, and a
 * run that was missed for three days still catches up on the fourth, because the
 * question is "which period is this user stamped for", not "what day is it".
 *
 * ## A user with no marker is stamped, not reset
 *
 * `seedOnly` covers the one case where those differ: a user created mid-period
 * has no marker and no balance, and resetting them to the allotment would be
 * indistinguishable from stamping them — until an admin has already adjusted
 * their balance by hand, at which point the first cron run would quietly undo
 * it. Seeding writes the marker and leaves any existing balance alone.
 */
export function computeLeaveReset(
  user: Pick<UserDocument, 'hasPaidLeave' | 'remainingUnpaidLeave' | 'remainingPaidLeave'> & {
    unpaidLeaveResetMonth?: string;
    paidLeaveResetYear?: number;
  },
  periods: { month: string; year: number },
): Record<string, string | number> | null {
  const updates: Record<string, string | number> = {};

  const storedMonth = typeof user.unpaidLeaveResetMonth === 'string' ? user.unpaidLeaveResetMonth : null;
  if (storedMonth !== periods.month) {
    updates.unpaidLeaveResetMonth = periods.month;
    // Seed rather than reset when we have never stamped this user: see above.
    const seedOnly = storedMonth === null && typeof user.remainingUnpaidLeave === 'number';
    if (!seedOnly) updates.remainingUnpaidLeave = UNPAID_LEAVE_DAYS_PER_MONTH;
  }

  // Paid leave resets only for users who have it. Someone without the
  // entitlement is stamped anyway, so switching it on mid-year does not hand
  // them a reset they were not owed — they get the allotment at the switch,
  // which is the admin's decision to make, not the cron's.
  const storedYear = typeof user.paidLeaveResetYear === 'number' ? user.paidLeaveResetYear : null;
  if (storedYear !== periods.year) {
    updates.paidLeaveResetYear = periods.year;
    const seedOnly = storedYear === null && typeof user.remainingPaidLeave === 'number';
    if (user.hasPaidLeave === true && !seedOnly) {
      updates.remainingPaidLeave = PAID_LEAVE_DAYS_PER_YEAR;
    }
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

/**
 * The fields a newly created user needs so their first period is not a reset.
 *
 * Spread into the `users` document at creation. Without it a new user has no
 * balance and no marker, which is the state that made the two defaults in this
 * codebase disagree in the first place.
 */
export function initialLeaveFields(now: number = Date.now()): Record<string, string | number> {
  const periods = leaveResetPeriods(now);
  return {
    remainingUnpaidLeave: UNPAID_LEAVE_DAYS_PER_MONTH,
    remainingPaidLeave: PAID_LEAVE_DAYS_PER_YEAR,
    unpaidLeaveResetMonth: periods.month,
    paidLeaveResetYear: periods.year,
  };
}
