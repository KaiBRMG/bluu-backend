/**
 * Leave balances are derived per period from requests (`leaveBalance.ts`).
 *
 * What these pin: a request is charged to the period of the **shift**, not the
 * day it was asked; denied and withdrawn requests give their day back by not
 * counting; an adjustment applies to its one period only; paid leave is a
 * yearly pot gated on `hasPaidLeave`; and only this month and next can be asked
 * for. The period boundary is the salary clock (Africa/Harare, UTC+2).
 */

import {
  DEFAULT_PAID_LEAVE_PER_YEAR,
  DEFAULT_UNPAID_LEAVE_PER_MONTH,
  computeLeaveBalance,
  isWithinRequestWindow,
  leaveAllotmentOf,
  leavePeriodOf,
} from '@/lib/leave/leaveBalance';

/** 10:00 salary time on a given day, as UTC ms. */
const at = (day: string, hour = 10) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00+02:00`);

const req = (day: string, status: string, leaveType: 'paid' | 'unpaid' = 'unpaid') => ({
  leaveType,
  status,
  occurrenceStart: at(day),
});

describe('periods', () => {
  test('unpaid is the salary month of the shift, paid its year', () => {
    expect(leavePeriodOf('unpaid', at('2026-11-03'))).toBe('2026-11');
    expect(leavePeriodOf('paid', at('2026-11-03'))).toBe('2026');
  });

  test('the boundary is the salary clock, not UTC', () => {
    // 23:30 UTC on 31 Oct is 01:30 on 1 Nov in Harare.
    const lateUtc = Date.parse('2026-10-31T23:30:00Z');
    expect(leavePeriodOf('unpaid', lateUtc)).toBe('2026-11');
  });
});

describe('computeLeaveBalance', () => {
  const user = { hasPaidLeave: true };

  test('defaults with no requests', () => {
    expect(computeLeaveBalance(user, [], 'unpaid', '2026-10').remaining).toBe(DEFAULT_UNPAID_LEAVE_PER_MONTH);
    expect(computeLeaveBalance(user, [], 'paid', '2026').remaining).toBe(DEFAULT_PAID_LEAVE_PER_YEAR);
  });

  test('pending and approved hold a day; denied does not', () => {
    const requests = [req('2026-10-05', 'pending'), req('2026-10-06', 'approved'), req('2026-10-07', 'denied')];
    const b = computeLeaveBalance(user, requests, 'unpaid', '2026-10');
    expect(b.used).toBe(2);
    expect(b.remaining).toBe(DEFAULT_UNPAID_LEAVE_PER_MONTH - 2);
  });

  test('a request for next month spends next month, not this one', () => {
    const requests = [req('2026-11-12', 'pending')];
    expect(computeLeaveBalance(user, requests, 'unpaid', '2026-10').used).toBe(0);
    expect(computeLeaveBalance(user, requests, 'unpaid', '2026-11').used).toBe(1);
  });

  test('nothing carries over: an unused month leaves the next at its allowance', () => {
    expect(computeLeaveBalance(user, [], 'unpaid', '2026-12').remaining).toBe(DEFAULT_UNPAID_LEAVE_PER_MONTH);
  });

  test('paid and unpaid are separate pots', () => {
    const requests = [req('2026-10-05', 'approved', 'paid')];
    expect(computeLeaveBalance(user, requests, 'unpaid', '2026-10').used).toBe(0);
    expect(computeLeaveBalance(user, requests, 'paid', '2026').used).toBe(1);
  });

  test('own allotment and a one-period adjustment', () => {
    const custom = {
      hasPaidLeave: true,
      leaveAllotment: { unpaidPerMonth: 2 },
      leaveAdjustments: { unpaid: { '2026-11': 3 } },
    };
    expect(computeLeaveBalance(custom, [], 'unpaid', '2026-10').remaining).toBe(2);
    expect(computeLeaveBalance(custom, [], 'unpaid', '2026-11').remaining).toBe(5);
  });

  test('an adjustment below what is approved goes negative rather than hiding it', () => {
    const custom = { leaveAdjustments: { unpaid: { '2026-10': -3 } } };
    const requests = [req('2026-10-05', 'approved'), req('2026-10-06', 'approved')];
    expect(computeLeaveBalance(custom, requests, 'unpaid', '2026-10').remaining).toBe(DEFAULT_UNPAID_LEAVE_PER_MONTH - 3 - 2);
  });

  test('no paid leave without the entitlement, whatever is stored', () => {
    const off = { hasPaidLeave: false, leaveAllotment: { paidPerYear: 10 }, leaveAdjustments: { paid: { '2026': 2 } } };
    // The standing figure stays readable for admins; the balance is gated.
    expect(leaveAllotmentOf(off, 'paid')).toBe(10);
    const b = computeLeaveBalance(off, [], 'paid', '2026');
    expect(b.allotment).toBe(0);
    expect(b.adjustment).toBe(0);
    expect(b.remaining).toBe(0);
  });
});

describe('isWithinRequestWindow', () => {
  const now = at('2026-10-20');

  test('this month and next only', () => {
    expect(isWithinRequestWindow(at('2026-10-25'), now)).toBe(true);
    expect(isWithinRequestWindow(at('2026-11-30'), now)).toBe(true);
    expect(isWithinRequestWindow(at('2026-12-01'), now)).toBe(false);
    expect(isWithinRequestWindow(at('2026-09-30'), now)).toBe(false);
  });

  test('December reaches into January', () => {
    expect(isWithinRequestWindow(at('2027-01-15'), at('2026-12-10'))).toBe(true);
  });
});
