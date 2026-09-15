/**
 * Sub-accounts price as peers of their parent.
 *
 * The design claim this pins: because a sub-account is simply **another id** in
 * `shifts.creatorIds` — a Firestore auto-id, disjoint from the creator auth uids
 * beside it — the salary engine needed no change at all to pay one correctly.
 * It counts ids; two ids are two accounts.
 *
 * If someone later "improves" the engine by grouping ids under a parent, or by
 * weighting a sub-account as a fraction, these fail — which is the point.
 */

import { computeSalaryMonth, DEFAULT_SALARY_CONFIG, hourlyRateFor } from '@/lib/salary/salaryEngine';
import type { SalaryDayInput, SalaryShiftInput } from '@/lib/salary/salaryTypes';

const C = DEFAULT_SALARY_CONFIG;
const H = 3600;

/** A creator id is an auth uid; a sub-account id is a Firestore auto-id. */
const COLE = 'kJ2mQ8vX1aBcDeFgHiJkLmNoPq02';
const COLE_FANSLY = '7fQ2xLm9ZaBcDeFg';
const ADAM = 'pL9xW3rT5uVwXyZaBcDeFgHiJk11';

function shift(over: Partial<SalaryShiftInput> = {}): SalaryShiftInput {
  return {
    shiftId: 's1',
    occurrenceStart: 0,
    scheduledHours: 8,
    trackedSeconds: 8 * H,
    creatorIds: [],
    isOvertime: false,
    paysWage: true,
    ...over,
  };
}

function day(shifts: SalaryShiftInput[]): SalaryDayInput {
  return { day: '2026-09-01', grossEarnings: 0, saleCount: 0, salesCreatorNames: [], shifts };
}

const price = (shifts: SalaryShiftInput[]) =>
  computeSalaryMonth({ userId: 'u', month: '2026-09', days: [day(shifts)], overrides: [], config: C }).days[0];

describe('a sub-account is a peer, not a child', () => {
  it('counts as its own account alongside its parent', () => {
    const result = price([shift({ creatorIds: [COLE, COLE_FANSLY] })]);
    expect(result.accountCount).toBe(2);
    expect(result.hourlyRate).toBe(hourlyRateFor(2, C));
  });

  it('pays the same whether the second account belongs to the same creator or another', () => {
    const sameCreator = price([shift({ creatorIds: [COLE, COLE_FANSLY] })]);
    const differentCreator = price([shift({ creatorIds: [COLE, ADAM] })]);

    expect(sameCreator.hourlyRate).toBe(differentCreator.hourlyRate);
    expect(sameCreator.wage).toBe(differentCreator.wage);
  });

  it('pays one account when only the sub-account is assigned', () => {
    // The case the whole model exists for: agent B works Cole (Fansly) while
    // agent A works Cole. B is on one account, not two, and not zero.
    const result = price([shift({ creatorIds: [COLE_FANSLY] })]);
    expect(result.accountCount).toBe(1);
    expect(result.hourlyRate).toBe(hourlyRateFor(1, C));
  });

  it('reaches the higher tiers by stacking sub-accounts', () => {
    const result = price([shift({ creatorIds: [COLE, COLE_FANSLY, ADAM] })]);
    expect(result.accountCount).toBe(3);
    expect(result.hourlyRate).toBe(hourlyRateFor(3, C));
    expect(result.wage).toBe(8 * hourlyRateFor(3, C));
  });

  it('still de-duplicates a repeated id', () => {
    expect(price([shift({ creatorIds: [COLE, COLE, COLE_FANSLY] })]).accountCount).toBe(2);
  });

  it('leaves the in-shift-cover rule intact for a sub-account', () => {
    // Cover taken inside an existing shift pays no extra wage, whether the
    // covered account is a creator or one of their sub-accounts.
    const result = price([
      shift({ creatorIds: [COLE] }),
      shift({ shiftId: 's2', creatorIds: [COLE_FANSLY], isOvertime: true, paysWage: false }),
    ]);
    expect(result.accountCount).toBe(1);
    expect(result.hours).toBe(8);
    expect(result.wage).toBe(8 * hourlyRateFor(1, C));
  });
});
