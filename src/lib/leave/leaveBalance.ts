/**
 * Leave balances: the allotments, the periods, and the one balance calculation.
 *
 * ## The model (2026-10-10)
 *
 * **A balance is derived, never stored.** For one person, one leave type and one
 * period:
 *
 *     remaining = allotment + adjustment − days held by requests in that period
 *
 * - **Unpaid leave is a monthly allowance; paid leave is a yearly one.** The
 *   period is a salary month (`YYYY-MM`) or salary year (`YYYY`) in
 *   `Africa/Harare` — the same clock the salary day uses.
 * - **Unpaid leave is always charged to the pool it was ASKED in** (2026-10-29):
 *   the salary month of `requestedAt`, whatever month the shift is in. Leave
 *   asked for in October for a November shift spends October's allowance; next
 *   month's pool is untouched until next month arrives. **Paid leave is
 *   charged to the year of the shift.**
 * - **A request holds a day while it is pending or approved.** A denial or a
 *   withdrawal (which deletes the request) gives it back simply by no longer
 *   counting — there is no refund write, so there is nothing to get wrong.
 * - **The allotment** is per person (`users.leaveAllotment`), falling back to
 *   the defaults below. Set in Shift Management → Settings → Leave, or on the
 *   person's own Leave tab.
 * - **An adjustment** is a one-off ± for one person in one period
 *   (`users.leaveAdjustments`), e.g. two extra unpaid days in November. Every
 *   change is written to the leave ledger with who made it.
 * - **Nothing carries over and nothing resets.** A new month simply has no
 *   requests in it yet. Finalising a salary month no longer touches leave.
 * - **Agents may ask for leave in this salary month or the next one**, never
 *   further out (`isWithinRequestWindow`).
 *
 * This replaced the stored `remainingUnpaidLeave` / `remainingPaidLeave` fields,
 * the reset stamps and the charge/refund markers. Those fields may still sit on
 * old documents; nothing reads them any more. Old requests need no migration —
 * every request carries `occurrenceStart` and `requestedAt`, which is all the
 * period needs. (The 2026-10-29 change re-derives existing unpaid requests into
 * the month they were asked in; nothing is rewritten.)
 */

import { addMonths, currentMonthKey, formatMonthLabel, toMonthKey } from '@/lib/salary/salaryDate';
import type { UserDocument } from '@/types/firestore';

/** Unpaid days a person gets each salary month unless their own allotment says otherwise. */
export const DEFAULT_UNPAID_LEAVE_PER_MONTH = 4;

/** Paid days a person with `hasPaidLeave` gets each salary year unless their own allotment says otherwise. */
export const DEFAULT_PAID_LEAVE_PER_YEAR = 10;

export const DEFAULT_ALLOTMENT: Record<LeaveType, number> = {
  unpaid: DEFAULT_UNPAID_LEAVE_PER_MONTH,
  paid: DEFAULT_PAID_LEAVE_PER_YEAR,
};

/** The ledger's `period` for a change to the standing allotment rather than one period. */
export const STANDING_PERIOD = 'standing';

/** Sanity ceilings for what an admin can type. Not policy — a typo guard. */
export const MAX_ALLOTMENT: Record<LeaveType, number> = { unpaid: 31, paid: 60 };
export const MAX_ADJUSTMENT = 31;

export type LeaveType = 'paid' | 'unpaid';

/** `YYYY-MM` for unpaid leave, `YYYY` for paid leave. */
export type LeavePeriod = string;

type LeaveUser = Pick<UserDocument, 'hasPaidLeave' | 'leaveAllotment' | 'leaveAdjustments'>;

type HeldLeave = { leaveType: LeaveType; occurrenceStart: number; status: string; requestedAt?: unknown };

/** What a request's period is read from. `requestedAt` is a Firestore `Timestamp` on the server, an ISO string on the client. */
export type LeavePeriodSource = { occurrenceStart: number; requestedAt?: unknown };

// ─── Periods ──────────────────────────────────────────────────────────────────

/**
 * Milliseconds from a `requestedAt` in any form a request travels in — a
 * Firestore `Timestamp` (server), an ISO string (the client hook), or a number.
 * `null` when it is none of them.
 */
function requestedAtMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (value as { toMillis(): number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * The period a request is charged to.
 *
 * - **Unpaid:** the salary month it was **requested** in, not the month of its
 *   shift — unpaid leave always comes out of the pool that is current when it
 *   is asked for. A request whose `requestedAt` cannot be read (none should be)
 *   falls back to its shift's month.
 * - **Paid:** the salary year of the shift.
 *
 * For a request being made right now, pass `requestedAt: Date.now()`.
 */
export function leavePeriodOf(type: LeaveType, request: LeavePeriodSource): LeavePeriod {
  if (type === 'paid') return toMonthKey(request.occurrenceStart).slice(0, 4);
  return toMonthKey(requestedAtMs(request.requestedAt) ?? request.occurrenceStart);
}

/** `'2026-11'` → `'November 2026'`; `'2026'` → `'2026'`. */
export function formatLeavePeriod(period: LeavePeriod): string {
  return period.length === 7 ? formatMonthLabel(period) : period;
}

/** Whether `period` is a well-formed key for this leave type. */
export function isLeavePeriod(type: LeaveType, period: unknown): period is LeavePeriod {
  if (typeof period !== 'string') return false;
  return type === 'paid' ? /^\d{4}$/.test(period) : /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

/** The salary months an agent may currently request leave in: this one and the next. */
export function requestableMonths(now: number = Date.now()): [string, string] {
  const current = currentMonthKey(now);
  return [current, addMonths(current, 1)];
}

/**
 * Whether a shift is close enough to ask for. The shift must start in this
 * salary month or the next — an allowance can only be spent once it is the
 * month it belongs to, or the month before.
 */
export function isWithinRequestWindow(occurrenceStart: number, now: number = Date.now()): boolean {
  const month = toMonthKey(occurrenceStart);
  const [current, next] = requestableMonths(now);
  return month === current || month === next;
}

// ─── The allotment ───────────────────────────────────────────────────────────

/**
 * This person's standing allotment of one leave type, per period — their own
 * figure or the default, **regardless of `hasPaidLeave`**. The entitlement gate
 * is applied once, in `computeLeaveBalance`; admin screens read this directly
 * so a person's paid allowance stays visible while the entitlement is off.
 */
export function leaveAllotmentOf(user: LeaveUser | null | undefined, type: LeaveType): number {
  const value = type === 'paid' ? user?.leaveAllotment?.paidPerYear : user?.leaveAllotment?.unpaidPerMonth;
  return wholeDays(value, DEFAULT_ALLOTMENT[type]);
}

/** Whether this person's allotment of a type is their own rather than the default. */
export function hasCustomAllotment(user: LeaveUser | null | undefined, type: LeaveType): boolean {
  const value = type === 'paid' ? user?.leaveAllotment?.paidPerYear : user?.leaveAllotment?.unpaidPerMonth;
  return typeof value === 'number' && Number.isFinite(value);
}

/** The one-off adjustment for one period, signed. `0` when there is none. */
export function leaveAdjustmentOf(user: LeaveUser | null | undefined, type: LeaveType, period: LeavePeriod): number {
  const value = user?.leaveAdjustments?.[type]?.[period];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function wholeDays(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

// ─── The balance ─────────────────────────────────────────────────────────────

/** Whether a request is holding a day of its period's allowance. */
export function holdsLeaveDay(leave: { status: string }): boolean {
  return leave.status === 'pending' || leave.status === 'approved';
}

export interface LeaveBalance {
  type: LeaveType;
  period: LeavePeriod;
  allotment: number;
  adjustment: number;
  /** Days held by pending and approved requests charged to the period (see `leavePeriodOf`). */
  used: number;
  /** May be negative when an adjustment was cut below what is already approved. */
  remaining: number;
}

/**
 * The balance for one person, type and period, from their requests.
 *
 * `requests` may be every request the person has made — anything of the other
 * type, in another period, or no longer holding a day is ignored here.
 *
 * **`hasPaidLeave` gates paid leave here and only here.** A person without the
 * entitlement has no paid allowance and no paid adjustment, whatever is stored,
 * because a stale allotment on someone whose paid leave was switched off is
 * exactly how they get told they have days they cannot take.
 */
export function computeLeaveBalance(
  user: LeaveUser | null | undefined,
  requests: readonly HeldLeave[],
  type: LeaveType,
  period: LeavePeriod,
): LeaveBalance {
  const entitled = type === 'unpaid' || user?.hasPaidLeave === true;
  const allotment = entitled ? leaveAllotmentOf(user, type) : 0;
  const adjustment = entitled ? leaveAdjustmentOf(user, type, period) : 0;
  let used = 0;
  for (const request of requests) {
    if (request.leaveType !== type || !holdsLeaveDay(request)) continue;
    if (leavePeriodOf(type, request) === period) used++;
  }
  return { type, period, allotment, adjustment, used, remaining: allotment + adjustment - used };
}

/**
 * The balance after one request changes state — a request holds exactly one
 * day while pending or approved, so the ledger's `after` is a ±1 of `before`
 * rather than a second pass over the requests. `next` null means deleted.
 */
export function remainingAfterChange(before: number, prev: { status: string }, next: { status: string } | null): number {
  return before + (holdsLeaveDay(prev) ? 1 : 0) - (next && holdsLeaveDay(next) ? 1 : 0);
}

/** "4 allowed · +1 adjusted · 2 requested or approved" — what a balance is made of. */
export function describeLeaveBalance(balance: LeaveBalance, options: { omitZeroUsed?: boolean } = {}): string {
  const parts = [`${balance.allotment} allowed`];
  if (balance.adjustment !== 0) parts.push(`${signedDays(balance.adjustment)} adjusted`);
  if (balance.used > 0 || !options.omitZeroUsed) parts.push(`${balance.used} requested or approved`);
  return parts.join(' · ');
}

/** `+2` / `-1` / `0`. */
export function signedDays(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

/** A remaining figure as shown: the number, or "N over" when an adjustment cut below what is approved. */
export function formatRemaining(remaining: number): string {
  return remaining < 0 ? `${-remaining} over` : String(remaining);
}

/** Whether typed text is a whole number of days from 0 to `max`. */
export function isWholeDays(value: string, max: number): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) <= max;
}
