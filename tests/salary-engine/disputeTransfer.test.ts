/**
 * Disputes v2 — the rules an approval now acts on. With BuddyX read-only an
 * approved dispute moves money, so who may claim what, how a submission
 * splits, and when an approval may transfer are pinned here.
 */
import {
  claimRefusal,
  groupByHolder,
  lockIsStale,
  NO_ONE,
  reassignRefusal,
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

  it('allows a PPV — the move happens in Bluu Backend, not BuddyX', () => {
    expect(claimRefusal(sale({ kind: 'ppv' }), 'u-filer', never)).toBeNull();
  });

  it.each([
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

describe('transferDecision — the filer already holds it', () => {
  it('reports a sale BuddyX re-credited to the filer as already done', () => {
    const held = { ...sale({ userId: 'u-filer', disputeId: 'd1' }), transferDisputeId: null };
    expect(transferDecision(held, { id: 'd1', assignedTo: 'u-holder', createdBy: 'u-filer' }, never)).toBe('already');
  });
});

describe('reassignRefusal', () => {
  const row = (over: Partial<Parameters<typeof reassignRefusal>[0] & object> = {}) => ({
    source: 'buddyx' as const,
    userId: 'u-a',
    sourceUserId: 'u-a',
    hasTransfer: false,
    removed: false,
    disputeId: null,
    month: '2026-10',
    ...over,
  });

  it('allows moving a BuddyX sale to another agent or to nobody', () => {
    expect(reassignRefusal(row(), 'u-b', never)).toBeNull();
    expect(reassignRefusal(row(), null, never)).toBeNull();
  });

  it.each([
    ['not-found', null, 'u-b'],
    ['not-buddyx', row({ source: 'infloww' }), 'u-b'],
    ['removed', row({ removed: true }), 'u-b'],
    ['disputed', row({ disputeId: 'd1' }), 'u-b'],
    ['same', row(), 'u-a'],
  ] as const)('refuses %s', (reason, r, to) => {
    expect(reassignRefusal(r, to, never)).toBe(reason);
  });

  it('allows clearing a transfer BuddyX has since agreed with', () => {
    expect(reassignRefusal(row({ hasTransfer: true }), 'u-a', never)).toBeNull();
  });

  it('refuses a month finalised for the current or the new holder', () => {
    expect(reassignRefusal(row(), 'u-b', uid => uid === 'u-a')).toBe('finalised');
    expect(reassignRefusal(row(), 'u-b', uid => uid === 'u-b')).toBe('finalised');
  });
});

describe('lockIsStale', () => {
  const snap = (exists: boolean, fields: Record<string, string> = {}) => ({ exists, get: (f: string) => fields[f] });

  it('holds while the dispute can still move the sale', () => {
    expect(lockIsStale(snap(true, { CaApproval: 'Pending', AdminApproval: 'Pending' }))).toBe(false);
    expect(lockIsStale(snap(true, { CaApproval: 'Approved', AdminApproval: 'Pending' }))).toBe(false);
  });

  it('is stale once decided, declined, or gone', () => {
    expect(lockIsStale(snap(true, { AdminApproval: 'Approved' }))).toBe(true);
    expect(lockIsStale(snap(true, { AdminApproval: 'Rejected' }))).toBe(true);
    expect(lockIsStale(snap(true, { CaApproval: 'Rejected', AdminApproval: 'Pending' }))).toBe(true);
    expect(lockIsStale(snap(false))).toBe(true);
  });
});
