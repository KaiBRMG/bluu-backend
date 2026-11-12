/**
 * The BuddyX → OnlyMonster cutover (migration plan §5.7, invariant 2).
 *
 * - `salesSourceFor` has three sides and exactly one owner per instant.
 * - The BuddyX vanished pass never soft-removes a row on OnlyMonster's side —
 *   the change that must ship, tested, before `ONLYMONSTER_CUTOVER_AT` is set.
 */
import { ONLYMONSTER_CUTOVER_AT, SALES_CUTOVER_AT, salesSourceFor } from '@/lib/salary/salaryConstants';
import { planSalesSync, resolveSaleIdentities, type NormalisedSale, type StoredSale } from '@/lib/buddyx/salesPlan';
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

describe('the BuddyX vanished pass stays on its own side', () => {
  const T = Date.parse('2026-12-01T22:00:00.000Z'); // a 00:00 SAST boundary
  const stored = (id: string, at: number): StoredSale => ({
    saleId: id,
    sourceId: id,
    kind: 'tip',
    matchKey: null,
    userId: 'ayo',
    month: '2026-12',
    transfer: null,
    removed: false,
    syncHash: 'x',
    vanishedAfterFinalise: false,
    occurredAtMs: at,
  });
  const run = (rows: StoredSale[], ownedUntil: number) => {
    const map = new Map(rows.map(r => [r.saleId, r]));
    return planSalesSync({
      identity: resolveSaleIdentities([] as NormalisedSale[], map),
      stored: map,
      chatters: new Map(),
      models: new Map(),
      finalized: new Set(),
      complete: true,
      ownedUntil,
    });
  };

  it('removes a vanished row at or before the cutover', () => {
    expect(run([stored('bx-tip-1', T)], T).removals).toEqual(['bx-tip-1']);
  });

  it('never removes a stored row after the cutover', () => {
    expect(run([stored('bx-tip-2', T + 1)], T).removals).toEqual([]);
  });

  it('keeps today’s behaviour for a row with no known instant', () => {
    expect(run([{ ...stored('bx-tip-3', T), occurredAtMs: undefined }], T).removals).toEqual(['bx-tip-3']);
  });
});

describe('disputes across the cutover (§5.4)', () => {
  const sale = (occurredAtMs: number) => ({ occurredAtMs, removed: false, userId: 'ayo', disputeId: null, month: '2026-11' });
  it('refuses an Infloww sale and accepts anything after the Infloww cutover', () => {
    expect(claimRefusal(sale(SALES_CUTOVER_AT) as never, 'dami', () => false)).toBe('before-cutover');
    expect(claimRefusal(sale(SALES_CUTOVER_AT + 1) as never, 'dami', () => false)).toBeNull();
  });
});
