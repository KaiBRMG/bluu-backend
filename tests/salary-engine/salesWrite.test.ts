/**
 * The BuddyX sales planner — the money path.
 *
 * Pins the four guarantees the sync rests on (documentation/buddyx.md §3.3):
 * the cutover, the attribution invariant (a sync never clears a transfer), the
 * finalised guard, and the vanished-row guard (nothing is removed on a partial
 * fetch, or inside a finalised month).
 */
import {
  normalisePpv,
  normaliseTip,
  pairKey,
  planSalesSync,
  tipSaleId,
  type ChatterRef,
  type ModelRef,
  type NormalisedSale,
  type StoredSale,
} from '@/lib/buddyx/salesPlan';
import { SALES_CUTOVER_AT, salesSourceFor } from '@/lib/salary/salaryConstants';
import type { BuddyxTipRow } from '@/lib/buddyx/types';

const AFTER = new Date(SALES_CUTOVER_AT + 3_600_000).toISOString(); // 2026-10-04 09:50 SAST
const MONTH = '2026-10';

const chatters = new Map<string, ChatterRef>([
  ['101', { uid: 'u-queen', email: 'q@x.com', name: 'Queen' }],
  ['102', { uid: 'u-jen', email: 'j@x.com', name: 'Jenelle' }],
  ['999', { uid: null, email: 'stranger@x.com', name: 'Stranger' }],
]);
const models = new Map<string, ModelRef>([['m1', { creatorId: 'c-adam', creatorName: 'Adam', handle: 'adamh' }]]);

function tipRow(over: Partial<BuddyxTipRow> = {}): BuddyxTipRow {
  return {
    id: 't1',
    modelId: 'm1',
    modelHandle: 'adamh',
    chatterId: 101,
    chatterName: 'Queen',
    fanId: 555,
    type: 'tips_messages',
    amount: { gross: 50, net: 40 },
    datePurchase: AFTER,
    ...over,
  };
}

const tip = (over: Partial<BuddyxTipRow> = {}) => normaliseTip(tipRow(over)) as NormalisedSale;

function plan(sales: NormalisedSale[], stored: StoredSale[] = [], opts: { finalized?: string[]; complete?: boolean } = {}) {
  return planSalesSync({
    sales,
    stored: new Map(stored.map(s => [s.saleId, s])),
    chatters,
    models,
    finalized: new Set(opts.finalized ?? []),
    complete: opts.complete ?? true,
  });
}

function storedFrom(sale: NormalisedSale, over: Partial<StoredSale> = {}): StoredSale {
  const first = plan([sale]).upserts[0].sale;
  return {
    saleId: sale.saleId,
    userId: first.userId,
    month: first.month,
    transfer: null,
    removed: false,
    syncHash: first.syncHash,
    vanishedAfterFinalise: false,
    ...over,
  };
}

describe('the cutover', () => {
  it('is 2026-10-04 08:50:31 SAST, and each side owns its own instant', () => {
    expect(new Date(SALES_CUTOVER_AT).toISOString()).toBe('2026-10-04T06:50:31.000Z');
    expect(salesSourceFor(SALES_CUTOVER_AT)).toBe('infloww');
    expect(salesSourceFor(SALES_CUTOVER_AT + 1)).toBe('buddyx');
  });

  it('drops BuddyX rows at or before the cutover', () => {
    expect(normaliseTip(tipRow({ datePurchase: new Date(SALES_CUTOVER_AT).toISOString() }))).toBeNull();
    expect(normaliseTip(tipRow({ datePurchase: AFTER }))).not.toBeNull();
  });
});

describe('normalisation', () => {
  it('stringifies numeric ids and derives net from gross', () => {
    const sale = tip({ amount: { gross: 10.01, net: 999 } });
    expect(sale.saleId).toBe(tipSaleId('t1'));
    expect(sale.chatterId).toBe('101');
    expect(sale.fanId).toBe('555');
    expect(sale.net).toBe(8.01);
  });

  it('treats a PPV row (no type) as a PPV dated by its unlock', () => {
    const ppv = normalisePpv({
      id: 'p1', modelId: 'm1', modelHandle: 'adamh', fanId: 1, chatterId: 102, chatterName: 'Jenelle',
      revenue: { gross: 20, net: 16 }, unlockDate: AFTER, createdAt: null,
    });
    expect(ppv).toMatchObject({ kind: 'ppv', type: 'ppv', saleId: 'bx-ppv-p1' });
  });
});

describe('attribution', () => {
  it('holds a sale on the chatter the source names', () => {
    const p = plan([tip()]);
    expect(p.upserts[0].sale).toMatchObject({ userId: 'u-queen', sourceUserId: 'u-queen', creatorId: 'c-adam', creatorName: 'Adam' });
  });

  it('holds an unassigned tip on nobody', () => {
    const p = plan([tip({ chatterId: null })]);
    expect(p.upserts[0].sale).toMatchObject({ userId: null, unmappedChatterId: null });
    expect(p.counts.unassigned).toBe(1);
  });

  it('holds an unmapped chatter on nobody, and reports the chatter', () => {
    const p = plan([tip({ chatterId: 999 })]);
    expect(p.upserts[0].sale).toMatchObject({ userId: null, unmappedChatterId: '999' });
    expect(p.unmappedChatters.get('999')).toEqual({ name: 'Queen', rows: 1, gross: 50 });
  });

  it('never clears a transfer, even when BuddyX re-attributes the sale', () => {
    const sale = tip();
    const stored = storedFrom(sale, { userId: 'u-jen', transfer: { fromUserId: 'u-queen', toUserId: 'u-jen' } });

    // Same source attribution as when it was transferred → still the filer's, no conflict.
    const same = plan([sale], [stored]);
    expect(same.upserts[0].sale).toMatchObject({ userId: 'u-jen', sourceUserId: 'u-queen', attributionConflict: false });

    // BuddyX now says someone else → the transfer stands, flagged for an admin.
    const moved = plan([tip({ chatterId: 999 })], [stored]);
    expect(moved.upserts[0].sale).toMatchObject({ userId: 'u-jen', attributionConflict: true });
    expect(moved.counts.attributionConflicts).toBe(1);
  });
});

describe('writes only what changed', () => {
  it('skips an unchanged row', () => {
    const sale = tip();
    const p = plan([sale], [storedFrom(sale)]);
    expect(p.upserts).toHaveLength(0);
    expect(p.counts.unchanged).toBe(1);
  });

  it('rewrites a row whose attribution moved, touching both agents', () => {
    const sale = tip();
    const p = plan([tip({ chatterId: 102 })], [storedFrom(sale)]);
    expect(p.upserts).toHaveLength(1);
    expect(p.touched).toEqual(new Set([pairKey('u-jen', MONTH), pairKey('u-queen', MONTH)]));
  });

  it('collapses a row yielded twice by a restarted pagination', () => {
    expect(plan([tip(), tip()]).counts.fetched).toBe(1);
  });
});

describe('the finalised guard', () => {
  it('refuses a change into a month finalised for the new holder', () => {
    const p = plan([tip()], [], { finalized: [pairKey('u-queen', MONTH)] });
    expect(p.upserts).toHaveLength(0);
    expect(p.rejectedFinalized).toEqual([{ saleId: tipSaleId('t1'), months: [MONTH] }]);
  });

  it('refuses a change out of a month finalised for the stored holder', () => {
    const sale = tip();
    const p = plan([tip({ chatterId: 102 })], [storedFrom(sale)], { finalized: [pairKey('u-queen', MONTH)] });
    expect(p.upserts).toHaveLength(0);
    expect(p.counts.rejectedFinalized).toBe(1);
  });
});

describe('vanished rows', () => {
  const sale = tip();

  it('soft-removes a stored row the API no longer returns', () => {
    const p = plan([], [storedFrom(sale)]);
    expect(p.removals).toEqual([sale.saleId]);
    expect(p.touched.has(pairKey('u-queen', MONTH))).toBe(true);
  });

  it('removes nothing when the fetch did not complete', () => {
    expect(plan([], [storedFrom(sale)], { complete: false }).removals).toEqual([]);
  });

  it('flags rather than removes inside a finalised month, once', () => {
    const p = plan([], [storedFrom(sale)], { finalized: [pairKey('u-queen', MONTH)] });
    expect(p.removals).toEqual([]);
    expect(p.vanishedFlags).toEqual([sale.saleId]);
    const again = plan([], [storedFrom(sale, { vanishedAfterFinalise: true })], { finalized: [pairKey('u-queen', MONTH)] });
    expect(again.vanishedFlags).toEqual([]);
  });

  it('restores a removed row that reappears', () => {
    const p = plan([sale], [storedFrom(sale, { removed: true })]);
    expect(p.upserts).toHaveLength(1);
    expect(p.counts.restored).toBe(1);
    expect(p.upserts[0].sale.removedAt).toBeNull();
  });
});
