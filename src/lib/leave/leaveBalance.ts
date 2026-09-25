/**
 * Leave balances: the allotments, the defaults, and the finalisation reset.
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
 * - **Unpaid leave: 4 days per salary month.**
 * - **Paid leave: 10 days per year**, and only for users with `hasPaidLeave`.
 *
 * **Balances reset when payroll finalises a month, not on a calendar date.**
 * Finalising an agent's month grants the *next* month's four unpaid days;
 * finalising their **December** also grants the next year's ten paid days. See
 * `computeFinalizationReset` below.
 *
 * Balances do not carry over. A reset is an assignment to the allotment, not an
 * increment, so an unused month does not compound into a fortnight.
 */

import { addMonths, type SalaryMonthKey } from '@/lib/salary/salaryDate';
import type { UserDocument } from '@/types/firestore';

/** Unpaid days granted each time a salary month is finalised. */
export const UNPAID_LEAVE_DAYS_PER_MONTH = 4;

/** Paid days granted when a December is finalised, for users with `hasPaidLeave`. */
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

// ─── Charging and refunding a request ─────────────────────────────────────────
//
// **Requesting takes the day; a denial or a withdrawal gives it back.** The
// balance an agent sees is therefore what they can still ask for — a pending
// request is already off it, rather than being a second number they have to
// subtract in their head.
//
// A request records *that* it took a day (`balanceCharged`) and *from which
// period* (`chargedPeriod`, the user's reset stamp at the time). The period is
// what makes a refund safe across a reset: a day taken from September's four
// and denied after September was finalised must not come back, because the
// finalisation already restored the balance to four — refunding it would hand
// out a fifth day.

type ResetStamps = {
  unpaidLeaveResetMonth?: unknown;
  paidLeaveResetYear?: unknown;
};

type LeaveUser = Pick<UserDocument, 'hasPaidLeave' | 'remainingUnpaidLeave' | 'remainingPaidLeave'> & ResetStamps;

type ChargeableLeave = {
  leaveType: LeaveType;
  status: string;
  balanceCharged?: boolean;
  chargedPeriod?: string | null;
};

/**
 * The reset period a user's balance of this type currently belongs to — their
 * stored stamp, not the wall clock. The stamp changes at exactly the moment a
 * fresh allotment is assigned (when a salary month is finalised), which the
 * calendar says nothing about.
 */
export function balancePeriodOf(user: ResetStamps | null | undefined, type: LeaveType): string | null {
  const stamp = type === 'paid' ? user?.paidLeaveResetYear : user?.unpaidLeaveResetMonth;
  return typeof stamp === 'string' || typeof stamp === 'number' ? String(stamp) : null;
}

/**
 * Whether a request is currently holding a day of the balance.
 *
 * Requests made before charging moved to request time carry no marker: the old
 * flow took the day at **approval**, so an unmarked approved request holds one
 * and an unmarked pending or denied request does not.
 */
export function isBalanceCharged(leave: ChargeableLeave): boolean {
  if (typeof leave.balanceCharged === 'boolean') return leave.balanceCharged;
  return leave.status === 'approved';
}

/** The balance a request can spend, read through `resolveLeaveBalances`. */
export function remainingOf(user: LeaveUser | null | undefined, type: LeaveType): number {
  const balances = resolveLeaveBalances(user);
  return type === 'paid' ? balances.paid : balances.unpaid;
}

/**
 * The writes that take one day for a request: the user update and the marker
 * for the leave document. The caller has already checked `remainingOf > 0`.
 */
export function leaveCharge(
  user: LeaveUser | null | undefined,
  type: LeaveType,
): { userUpdate: Record<string, number>; leaveUpdate: { balanceCharged: true; chargedPeriod: string | null } } {
  return {
    userUpdate: { [LEAVE_BALANCE_FIELD[type]]: remainingOf(user, type) - 1 },
    leaveUpdate: { balanceCharged: true, chargedPeriod: balancePeriodOf(user, type) },
  };
}

/**
 * The user update that gives a request's day back, or `null` when nothing is
 * owed — the request never took one, or a reset has happened since it did.
 *
 * When the period it was taken from is known and still current, the day goes
 * back uncapped: it is exactly the day that was taken, and capping it would
 * swallow days an admin granted above the allotment. When the period is unknown
 * (a legacy approval, or a user who had no stamp), the refund is capped at the
 * allotment — the conservative guess, and the rule this code used before the
 * period was recorded.
 */
export function leaveRefund(
  user: LeaveUser | null | undefined,
  leave: ChargeableLeave,
): Record<string, number> | null {
  if (!isBalanceCharged(leave)) return null;

  const type = leave.leaveType;
  const next = remainingOf(user, type) + 1;
  const charged = typeof leave.chargedPeriod === 'string' ? leave.chargedPeriod : null;
  const current = balancePeriodOf(user, type);

  if (charged !== null && current !== null) {
    return charged === current ? { [LEAVE_BALANCE_FIELD[type]]: next } : null;
  }
  return { [LEAVE_BALANCE_FIELD[type]]: Math.min(next, LEAVE_ALLOTMENT[type]) };
}

// ─── The reset: triggered by finalising a salary month ────────────────────────

/**
 * The balance updates finalising `finalizedMonth` owes this agent, or `null`
 * when they are already reset for what comes next.
 *
 * - **Every month:** unpaid leave is assigned `4` for the month *after* the one
 *   finalised, and `unpaidLeaveResetMonth` is stamped with that month.
 * - **December:** paid leave is also assigned `10` for the following year (for
 *   users with `hasPaidLeave`), and `paidLeaveResetYear` is stamped with it.
 *
 * **Assigned, never added.** Days an agent did not use are gone, not carried
 * over. So finalising a month in which someone took no leave still leaves them
 * with 4, not 8.
 *
 * ## Why the stamp, and why it only moves forward
 *
 * The stamp records which period the current balance belongs to. A reset
 * applies only when that period is **later** than the stored stamp, and that
 * one comparison covers the awkward cases:
 * - **Reopen and finalise again** is a no-op. The stamp already says "October",
 *   so days the agent has used since the first finalise are not handed back.
 * - **Finalising out of order** is a no-op for the earlier month. Finalising
 *   September after October must not reset them back to a September balance.
 * - **Refunds use the same stamp** (`balancePeriodOf` → `leaveRefund`), so a day
 *   taken before a reset and denied after it is not refunded on top of the fresh
 *   allotment.
 *
 * A user with no stamp (never reset) is reset. Their first finalised month is
 * the first point at which an allotment is owed on these rules.
 *
 * Paid leave is stamped even for users without the entitlement. Switching
 * `hasPaidLeave` on mid-year therefore does not trigger a reset nobody granted.
 * The allotment at that moment is the admin's call.
 *
 * Pure, so it is testable without Firestore. The caller writes the result in
 * the same transaction as the finalised month.
 */
export function computeFinalizationReset(
  user: ResetStamps & Pick<UserDocument, 'hasPaidLeave'> | null | undefined,
  finalizedMonth: SalaryMonthKey,
): Record<string, string | number> | null {
  const updates: Record<string, string | number> = {};

  const nextMonth = addMonths(finalizedMonth, 1);
  const storedMonth = typeof user?.unpaidLeaveResetMonth === 'string' ? user.unpaidLeaveResetMonth : null;
  // `YYYY-MM` compares correctly as a string.
  if (storedMonth === null || storedMonth < nextMonth) {
    updates.remainingUnpaidLeave = UNPAID_LEAVE_DAYS_PER_MONTH;
    updates.unpaidLeaveResetMonth = nextMonth;
  }

  if (finalizedMonth.endsWith('-12')) {
    const nextYear = Number(finalizedMonth.slice(0, 4)) + 1;
    const storedYear = typeof user?.paidLeaveResetYear === 'number' ? user.paidLeaveResetYear : null;
    if (storedYear === null || storedYear < nextYear) {
      updates.paidLeaveResetYear = nextYear;
      if (user?.hasPaidLeave === true) updates.remainingPaidLeave = PAID_LEAVE_DAYS_PER_YEAR;
    }
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

