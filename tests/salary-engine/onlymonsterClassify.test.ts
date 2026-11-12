/**
 * OnlyFans transaction type/status → category. The strings are free text that a
 * platform may extend at any time, so the classifier must never guess money:
 * anything unrecognised is `other`, and only an exact tip or message payment can
 * ever become a `ca-sales` row (D3, invariant 8). Strings are the ones the Phase 0
 * probe saw (onlymonster-migration.md §11, V1).
 */
import { categoryOf, classifyTransaction, netOf, payKindOf, statusClassOf } from '@/lib/onlymonster/classify';

describe('categoryOf', () => {
  it('maps every type string the probe saw', () => {
    expect(categoryOf('Tip from')).toBe('tip');
    expect(categoryOf('Payment for message')).toBe('message');
    expect(categoryOf('Subscription')).toBe('subscription');
    expect(categoryOf('Recurring subscription')).toBe('renewal');
  });

  it('maps the documented but unseen strings', () => {
    expect(categoryOf('Post purchase')).toBe('post');
    expect(categoryOf('Live stream')).toBe('stream');
  });

  it('folds case and whitespace, nothing more', () => {
    expect(categoryOf('  tip   FROM ')).toBe('tip');
    expect(categoryOf('payment for message')).toBe('message');
  });

  it('files anything unknown as other, never as money it might be', () => {
    expect(categoryOf('Unknown')).toBe('other');
    expect(categoryOf('unknown')).toBe('other');
    expect(categoryOf('Tip from campaign refund')).toBe('other');
    expect(categoryOf('Payment for message (refunded)')).toBe('other');
    expect(categoryOf('')).toBe('other');
    expect(categoryOf(null)).toBe('other');
    expect(categoryOf(undefined)).toBe('other');
  });
});

describe('payKindOf (D3: tips + PPV messages only)', () => {
  it('only tips and message payments reach pay', () => {
    expect(payKindOf('tip')).toBe('tip');
    expect(payKindOf('message')).toBe('ppv');
    for (const c of ['subscription', 'renewal', 'post', 'stream', 'other'] as const) expect(payKindOf(c)).toBeNull();
  });
});

describe('statusClassOf', () => {
  it('names the three documented statuses', () => {
    expect(statusClassOf('done')).toBe('settled');
    expect(statusClassOf('loading')).toBe('held');
    expect(statusClassOf('pending_return')).toBe('pending-return');
  });

  it('surfaces anything else as unknown', () => {
    expect(statusClassOf('completed')).toBe('unknown');
    expect(statusClassOf('')).toBe('unknown');
    expect(statusClassOf(null)).toBe('unknown');
  });
});

describe('classifyTransaction', () => {
  it('combines the three', () => {
    expect(classifyTransaction({ type: 'Payment for message', status: 'loading' })).toEqual({
      category: 'message',
      payKind: 'ppv',
      statusClass: 'held',
    });
  });
});

describe('netOf (V3: per transaction, then summed)', () => {
  it('rounds each transaction to the cent', () => {
    expect(netOf(9.99)).toBe(7.99);
    expect(netOf(60)).toBe(48);
    expect(netOf(4.99)).toBe(3.99);
  });

  it('reproduces OnlyMonster/OnlyFans net for the probed day, where summing first is 2 cents off', () => {
    // 87963 on 2026-11-09: 4 tips (195), 6 subs + 5 renewals at 9.99, 6 PPV (308); overview net 490.29.
    // Whole-dollar amounts are reconstructed from the per-type totals (whole dollars carry no rounding);
    // the eleven 9.99s are what make per-transaction and sum-then-round disagree.
    const amounts = [60, 100, 5, 30, ...Array(11).fill(9.99), 70, 60, 150, 10, 10, 8];
    const gross = amounts.reduce((s, a) => s + a, 0);
    const perTx = Math.round(amounts.reduce((s, a) => s + netOf(a), 0) * 100) / 100;
    expect(Math.round(gross * 100) / 100).toBe(612.89);
    expect(perTx).toBe(490.29);
    expect(Math.round(gross * 0.8 * 100) / 100).toBe(490.31);
  });
});
