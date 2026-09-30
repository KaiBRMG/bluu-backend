/**
 * A sale belongs to the shift it was made on.
 *
 * Shifts are paid on the day they start, so a 23:00–07:00 SAST shift's
 * post-midnight sales must land on its first day — and on the last night of a
 * month, in the month finalised and paid on the 1st, not the next one.
 */

import { attributeSalesToShifts, type ShiftWindow } from '@/lib/salary/salesImport';
import { toDayKey, toMonthKey } from '@/lib/salary/salaryDate';
import type { SalarySale } from '@/lib/salary/salaryTypes';

/** A wall-clock time in SAST (UTC+2) → UTC ms. */
const sast = (iso: string) => Date.parse(`${iso}+02:00`);

function sale(id: string, at: string, userId = 'agent'): SalarySale {
  const ms = sast(at);
  return {
    saleId: id,
    userId,
    day: toDayKey(ms),
    month: toMonthKey(ms),
    occurredAt: new Date(ms).toISOString(),
    employeeName: '',
    sourceEmail: '',
    creatorName: '',
    fanName: '',
    fanId: '',
    grossRevenue: 10,
    netRevenue: 8,
    signedGross: 10,
    type: '',
    rule: '',
    assignedBy: '',
    status: 'complete',
    importId: 'imp',
  };
}

const overnight = (startIso: string, hours = 8): ShiftWindow => ({
  start: sast(startIso),
  end: sast(startIso) + hours * 3_600_000,
});

describe('attributeSalesToShifts', () => {
  const lastNight = new Map([['agent', [overnight('2026-08-31T23:00:00')]]]);

  it('moves a post-midnight sale on the 1st back into the previous month', () => {
    const { sales, moved, movedAcrossMonth } = attributeSalesToShifts([sale('a', '2026-09-01T02:30:00')], lastNight);
    expect(sales[0].day).toBe('2026-08-31');
    expect(sales[0].month).toBe('2026-08');
    expect(moved.has('a')).toBe(true);
    expect(movedAcrossMonth.has('a')).toBe(true);
  });

  it('leaves a pre-midnight sale on the shift day untouched', () => {
    const input = sale('b', '2026-08-31T23:30:00');
    const { sales, moved } = attributeSalesToShifts([input], lastNight);
    expect(sales[0]).toBe(input);
    expect(moved.size).toBe(0);
  });

  it('treats the shift end as exclusive — a sale at 07:00 is outside it', () => {
    const { sales } = attributeSalesToShifts([sale('c', '2026-09-01T07:00:00')], lastNight);
    expect(sales[0].day).toBe('2026-09-01');
    expect(sales[0].month).toBe('2026-09');
  });

  it('keeps the calendar day for a sale inside no shift', () => {
    const { sales } = attributeSalesToShifts([sale('d', '2026-09-01T12:00:00')], lastNight);
    expect(sales[0].day).toBe('2026-09-01');
  });

  it('only uses the selling agent’s own shifts', () => {
    const { sales } = attributeSalesToShifts([sale('e', '2026-09-01T02:30:00', 'someone-else')], lastNight);
    expect(sales[0].day).toBe('2026-09-01');
  });

  it('moves mid-month overnight sales within the month', () => {
    const windows = new Map([['agent', [overnight('2026-09-14T23:00:00')]]]);
    const { sales, moved, movedAcrossMonth } = attributeSalesToShifts([sale('f', '2026-09-15T04:00:00')], windows);
    expect(sales[0].day).toBe('2026-09-14');
    expect(moved.has('f')).toBe(true);
    expect(movedAcrossMonth.size).toBe(0);
  });

  it('gives an overlapped sale to the later-starting shift', () => {
    const windows = new Map([
      ['agent', [overnight('2026-08-31T23:00:00'), { start: sast('2026-09-01T06:00:00'), end: sast('2026-09-01T14:00:00') }]],
    ]);
    const { sales } = attributeSalesToShifts([sale('g', '2026-09-01T06:30:00')], windows);
    expect(sales[0].day).toBe('2026-09-01');
  });
});
