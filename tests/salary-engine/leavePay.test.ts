/**
 * What approved leave does to pay (`leavePay.ts` + the engine's `paidLeave`).
 *
 * What these pin: a sale inside a leave shift's window does not count — matched
 * by timestamp, so a second shift the same day keeps its sales; paid leave pays
 * a flat 8 hours, no grace, at the rate for the previous day's paying accounts,
 * walking back past days off and more leave; and paid-leave hours do not make a
 * day count as worked.
 */

import { computeSalaryMonth, DEFAULT_SALARY_CONFIG, hourlyRateFor } from '@/lib/salary/salaryEngine';
import { leaveAt, paidAccountsByDay, paidLeaveShifts, type LeaveWindow } from '@/lib/salary/leavePay';
import { PAID_LEAVE_HOURS } from '@/lib/salary/salaryConstants';
import type { SalaryDayInput } from '@/lib/salary/salaryTypes';

const C = DEFAULT_SALARY_CONFIG;
/** A time on a salary day (Africa/Harare, UTC+2), as UTC ms. */
const at = (day: string, hour = 10) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00+02:00`);

const window = (day: string, leaveType: 'paid' | 'unpaid' = 'paid', hour = 10, hours = 8): LeaveWindow => ({
  leaveId: `L-${day}`,
  leaveType,
  start: at(day, hour),
  end: at(day, hour) + hours * 3_600_000,
});

describe('leaveAt', () => {
  const w = window('2026-10-06', 'unpaid', 10);

  test('inside the shift window is on leave, edges half-open', () => {
    expect(leaveAt(at('2026-10-06', 10), [w])).toBe(w);
    expect(leaveAt(at('2026-10-06', 17), [w])).toBe(w);
    expect(leaveAt(at('2026-10-06', 18), [w])).toBeNull();
    expect(leaveAt(at('2026-10-06', 9), [w])).toBeNull();
  });

  test('a second shift the same day keeps its sales', () => {
    expect(leaveAt(at('2026-10-06', 20), [w])).toBeNull();
  });
});

describe('paidAccountsByDay', () => {
  test('counts paying shifts only, without in-shift overtime', () => {
    const byDay = paidAccountsByDay([
      { occurrenceStart: at('2026-10-05'), creatorIds: ['a', 'b', 'c'], overtimeCreatorIds: ['c'] },
      { occurrenceStart: at('2026-10-05', 20), creatorIds: ['d'], paysWage: false },
    ]);
    expect([...(byDay.get('2026-10-05') ?? [])].sort()).toEqual(['a', 'b']);
  });
});

describe('paidLeaveShifts', () => {
  const accounts = paidAccountsByDay([
    { occurrenceStart: at('2026-10-02'), creatorIds: ['a', 'b'] },
    { occurrenceStart: at('2026-10-05'), creatorIds: ['a', 'b', 'c', 'd'] },
  ]);

  test("rates on the previous day's accounts", () => {
    const [shift] = paidLeaveShifts([window('2026-10-06')], accounts).get('2026-10-06')!;
    expect(shift.paidLeave).toBe(true);
    expect(shift.scheduledHours).toBe(PAID_LEAVE_HOURS);
    expect(shift.creatorIds.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(shift.paidLeaveBasisDay).toBe('2026-10-05');
  });

  test('walks back past days off and consecutive leave', () => {
    const out = paidLeaveShifts([window('2026-10-06'), window('2026-10-07')], accounts);
    expect(out.get('2026-10-07')![0].paidLeaveBasisDay).toBe('2026-10-05');
    expect(paidLeaveShifts([window('2026-10-04')], accounts).get('2026-10-04')![0].paidLeaveBasisDay).toBe('2026-10-02');
  });

  test('nothing within the lookback pays on no accounts, and says so', () => {
    const [shift] = paidLeaveShifts([window('2026-10-20')], accounts).get('2026-10-20')!;
    expect(shift.creatorIds).toEqual([]);
    expect(shift.paidLeaveBasisDay).toBeNull();
  });

  test('unpaid leave adds no shift', () => {
    expect(paidLeaveShifts([window('2026-10-06', 'unpaid')], accounts).size).toBe(0);
  });
});

describe('the engine pays paid leave', () => {
  const run = (days: SalaryDayInput[]) =>
    computeSalaryMonth({ userId: 'u', month: '2026-10', days, overrides: [], config: C });

  const leaveDay = (): SalaryDayInput => ({
    day: '2026-10-06',
    grossEarnings: 0,
    saleCount: 0,
    salesCreatorNames: [],
    shifts: paidLeaveShifts([window('2026-10-06')], paidAccountsByDay([
      { occurrenceStart: at('2026-10-05'), creatorIds: ['a', 'b', 'c'] },
    ])).get('2026-10-06')!,
  });

  test('8 hours, no grace, at the rate for those accounts', () => {
    const d = run([leaveDay()]).days.find(x => x.day === '2026-10-06')!;
    expect(d.hours).toBe(8);
    expect(d.trackedHours).toBe(0);
    expect(d.accountCount).toBe(3);
    expect(d.hourlyRate).toBe(hourlyRateFor(3, C));
    expect(d.wage).toBe(8 * hourlyRateFor(3, C));
    expect(d.shifts[0].paidLeave).toBe(true);
  });

  test('is paid but not counted as a day worked', () => {
    const result = run([leaveDay()]);
    expect(result.totals.wage).toBe(8 * hourlyRateFor(3, C));
    expect(result.totals.daysWorked).toBe(0);
  });
});
