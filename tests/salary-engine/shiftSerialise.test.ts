/**
 * Shift serialisation — the boundary between Firestore and recurrence expansion.
 *
 * Lives beside the salary tests because `serialiseShift` is a salary input:
 * `creatorIds` is what sets an agent's hourly wage tier, and the recurrence it
 * expands is what decides which days they were rostered on at all.
 *
 * ## The regression this exists for
 *
 * `recurrence.endDate` had two writers that never agreed. `createShift` stored
 * whatever the client sent — and the shift modal sends an ISO **string** —
 * while `truncateSeriesAt` wrote a real `Timestamp`. `serialiseRecurrence`
 * assumed `Timestamp` and called `.toDate()`, so a single recurring shift with
 * an end date threw `r.endDate.toDate is not a function` and returned a 500 for
 * the **entire** week view.
 *
 * The write side now normalises and the read side tolerates every shape that
 * was ever written. Neither half is redundant: the write fix stops new bad
 * documents, the read fix keeps the ones already in Firestore from taking the
 * roster down.
 */

import { serialiseRecurrence, serialiseShift } from '@/lib/utils/shiftSerialise';
import type { ShiftDocument } from '@/types/firestore';

/** A stand-in for a Firestore Timestamp — duck-typed exactly as the reader tests it. */
const ts = (ms: number) => ({ toDate: () => new Date(ms), toMillis: () => ms });

const OCT_31 = Date.UTC(2026, 9, 31);
const OCT_31_ISO = '2026-10-31T00:00:00.000Z';

const baseRecurrence = {
  frequency: 'weekly' as const,
  interval: 1,
  daysOfWeek: [1],
  count: null,
  parentShiftId: null,
};

const recurrenceWith = (endDate: unknown) =>
  serialiseRecurrence({ ...baseRecurrence, endDate } as ShiftDocument['recurrence']);

describe('serialiseRecurrence endDate', () => {
  it('accepts the ISO string the shift modal writes (the 500)', () => {
    expect(recurrenceWith(OCT_31_ISO)?.endDate).toBe(OCT_31_ISO);
  });

  it('accepts the Timestamp truncateSeriesAt writes', () => {
    expect(recurrenceWith(ts(OCT_31))?.endDate).toBe(OCT_31_ISO);
  });

  it('accepts epoch millis and a prototype-stripped {seconds} Timestamp', () => {
    expect(recurrenceWith(OCT_31)?.endDate).toBe(OCT_31_ISO);
    expect(recurrenceWith({ seconds: OCT_31 / 1000 })?.endDate).toBe(OCT_31_ISO);
  });

  it('treats a missing end date as "runs forever"', () => {
    expect(recurrenceWith(null)?.endDate).toBeNull();
    expect(recurrenceWith(undefined)?.endDate).toBeNull();
  });

  // A series that visibly never ends gets noticed and corrected. One that throws
  // blanks the roster for everyone.
  it('degrades an unreadable value to null instead of throwing', () => {
    expect(() => recurrenceWith('not a date')).not.toThrow();
    expect(recurrenceWith('not a date')?.endDate).toBeNull();
    expect(recurrenceWith({})?.endDate).toBeNull();
    expect(recurrenceWith(Number.NaN)?.endDate).toBeNull();
  });

  it('passes a null recurrence straight through', () => {
    expect(serialiseRecurrence(null)).toBeNull();
  });

  it('keeps the rest of the rule intact', () => {
    const r = recurrenceWith(OCT_31_ISO);
    expect(r).toMatchObject({ frequency: 'weekly', interval: 1, daysOfWeek: [1], count: null });
  });
});

describe('serialiseShift', () => {
  const shift = {
    shiftId: 's1',
    userId: 'u1',
    startTime: ts(1_000),
    endTime: ts(2_000),
    wallClockStart: '09:00',
    wallClockEnd: '17:00',
    userTimezone: 'Africa/Harare',
    isRecurring: true,
    recurrence: { ...baseRecurrence, endDate: OCT_31_ISO },
    seriesId: null,
    overrideDate: null,
    isDeleted: false,
  } as unknown as ShiftDocument;

  it('survives a shift whose recurrence carries the string end date', () => {
    expect(() => serialiseShift(shift)).not.toThrow();
    expect(serialiseShift(shift).recurrence?.endDate).toBe(OCT_31_ISO);
  });

  it('defaults the salary-relevant fields so consumers need no guards', () => {
    const out = serialiseShift(shift);
    expect(out.creatorIds).toEqual([]);
    expect(out.isOvertime).toBe(false);
    expect(out.paysWage).toBe(true);
    expect(out.coverageOfferId).toBeNull();
  });

  it('carries a real creator assignment through unchanged', () => {
    const assigned = { ...shift, creatorIds: ['c1', 'c2'], isOvertime: true, paysWage: false } as ShiftDocument;
    const out = serialiseShift(assigned);
    expect(out.creatorIds).toEqual(['c1', 'c2']);
    expect(out.isOvertime).toBe(true);
    expect(out.paysWage).toBe(false);
  });

  it('serialises the occurrence override date when present', () => {
    const override = { ...shift, overrideDate: ts(OCT_31) } as ShiftDocument;
    expect(serialiseShift(override).overrideDate).toBe(OCT_31_ISO);
  });
});
