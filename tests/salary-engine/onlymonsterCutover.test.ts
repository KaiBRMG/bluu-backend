/**
 * The BuddyX → OnlyMonster cutover (migration plan §5.7, invariant 2).
 *
 * - `salesSourceFor` has three sides and exactly one owner per instant. It
 *   outlives the BuddyX sync: it is what stops OnlyMonster writing a sale the
 *   frozen BuddyX rows already hold (double pay).
 * - BuddyX-era sales stay disputable after BuddyX is gone.
 */
import { ONLYMONSTER_CUTOVER_AT, SALES_CUTOVER_AT, salesSourceFor } from '@/lib/salary/salaryConstants';
import { claimRefusal } from '@/lib/disputes/disputeRules';

describe('salesSourceFor', () => {
  it('has exactly one owner per instant across both cutovers (D25: 2026-11-06 01:00 SAST)', () => {
    expect(ONLYMONSTER_CUTOVER_AT).toBe(Date.parse('2026-11-05T23:00:00.000Z'));
    expect(salesSourceFor(SALES_CUTOVER_AT)).toBe('infloww');
    expect(salesSourceFor(SALES_CUTOVER_AT + 1)).toBe('buddyx');
    expect(salesSourceFor(ONLYMONSTER_CUTOVER_AT)).toBe('buddyx');
    expect(salesSourceFor(ONLYMONSTER_CUTOVER_AT + 1)).toBe('onlymonster');
  });
});

describe('disputes across the cutover (§5.4)', () => {
  const sale = (occurredAtMs: number) => ({ occurredAtMs, removed: false, userId: 'ayo', disputeId: null, month: '2026-11' });
  it('refuses an Infloww sale and accepts anything after the Infloww cutover', () => {
    expect(claimRefusal(sale(SALES_CUTOVER_AT) as never, 'dami', () => false)).toBe('before-cutover');
    expect(claimRefusal(sale(SALES_CUTOVER_AT + 1) as never, 'dami', () => false)).toBeNull();
  });
  it('keeps a BuddyX-era sale (1–5 Nov) claimable', () => {
    expect(claimRefusal(sale(ONLYMONSTER_CUTOVER_AT) as never, 'dami', () => false)).toBeNull();
    expect(claimRefusal(sale(ONLYMONSTER_CUTOVER_AT + 1) as never, 'dami', () => false)).toBeNull();
  });
});
