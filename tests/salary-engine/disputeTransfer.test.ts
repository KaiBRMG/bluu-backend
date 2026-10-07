/**
 * Disputes v2 — the rules an approval now acts on. With BuddyX read-only an
 * approved dispute moves money, so who may claim what, how a submission
 * splits, and when an approval may transfer are pinned here.
 */
import {
  claimRefusal,
  groupByHolder,
  NO_ONE,
  transferDecision,
  type ClaimableSale,
} from '@/lib/disputes/disputeRules';
import { SALES_CUTOVER_AT } from '@/lib/salary/salaryConstants';

const AFTER = SALES_CUTOVER_AT + 3_600_000;
const never = () => false;

function sale(over: Partial<ClaimableSale> = {}): ClaimableSale {
  return {
    saleId: 's1',
    kind: 'tip',
    occurredAtMs: AFTER,
    month: '2026-10',
    userId: 'u-holder',
    removed: false,
    disputeId: null,
    ...over,
  };
}

describe('claimRefusal', () => {
  it('allows a tip someone else holds', () => {
    expect(claimRefusal(sale(), 'u-filer', never)).toBeNull();
  });

  it('allows an unassigned tip', () => {
    expect(claimRefusal(sale({ userId: null }), 'u-filer', never)).toBeNull();
  });

  it.each([
    ['ppv', sale({ kind: 'ppv' })],
    ['before-cutover', sale({ occurredAtMs: SALES_CUTOVER_AT })],
    ['removed', sale({ removed: true })],
    ['yours', sale({ userId: 'u-filer' })],
    ['disputed', sale({ disputeId: 'd-other' })],
  ] as const)('refuses %s', (reason, s) => {
    expect(claimRefusal(s, 'u-filer', never)).toBe(reason);
  });

  it('refuses a month finalised for either party', () => {
    expect(claimRefusal(sale(), 'u-filer', uid => uid === 'u-filer')).toBe('finalised');
    expect(claimRefusal(sale(), 'u-filer', uid => uid === 'u-holder')).toBe('finalised');
  });

  it('refuses a sale that does not exist', () => {
    expect(claimRefusal(null, 'u-filer', never)).toBe('not-found');
  });
});

describe('groupByHolder', () => {
  it('splits one submission per holder, unassigned last (D5)', () => {
    const groups = groupByHolder([
      { id: 1, userId: null },
      { id: 2, userId: 'u-b' },
      { id: 3, userId: 'u-a' },
      { id: 4, userId: 'u-b' },
    ]);
    expect(groups.map(g => [g.holder, g.sales.map(s => s.id)])).toEqual([
      ['u-a', [3]],
      ['u-b', [2, 4]],
      [NO_ONE, [1]],
    ]);
  });
});

describe('transferDecision', () => {
  const dispute = { id: 'd1', assignedTo: 'u-holder', createdBy: 'u-filer' };
  const live = (over: Partial<ClaimableSale & { transferDisputeId: string | null }> = {}) => ({
    ...sale({ disputeId: 'd1' }),
    transferDisputeId: null,
    ...over,
  });

  it('transfers a sale still held as claimed', () => {
    expect(transferDecision(live(), dispute, never)).toBe('transfer');
  });

  it('transfers an unassigned tip claimed through No One', () => {
    expect(transferDecision(live({ userId: null }), { ...dispute, assignedTo: NO_ONE }, never)).toBe('transfer');
  });

  it('skips a sale whose holder changed since filing', () => {
    expect(transferDecision(live({ userId: 'u-third' }), dispute, never)).toBe('holder-changed');
  });

  it('skips a sale in a finalised month', () => {
    expect(transferDecision(live(), dispute, uid => uid === 'u-filer')).toBe('finalised');
  });

  it('skips a removed sale and one locked by another dispute', () => {
    expect(transferDecision(live({ removed: true }), dispute, never)).toBe('removed');
    expect(transferDecision(live({ disputeId: 'd2' }), dispute, never)).toBe('locked');
  });

  it('treats approving twice as already done', () => {
    expect(transferDecision(live({ userId: 'u-filer', transferDisputeId: 'd1', disputeId: null }), dispute, never)).toBe('already');
  });
});
