/**
 * The OnlyMonster pay derivation (migration plan §5, D2/D3/D8/D16/D17). Pins the
 * invariants carried over from BuddyX (transfer never cleared, finalised months
 * frozen, only changed rows written) and the new strict shift rule.
 */
import {
  attributeAll,
  clampDeparted,
  omChargebackSaleId,
  omSaleId,
  pairKey,
  planPay,
  type ChargebackInput,
  type LedgerSaleInput,
  type StoredOmSale,
} from '@/lib/onlymonster/payPlan';
import { toMonthKey } from '@/lib/salary/salaryDate';

const H = 3600_000;
const T = Date.parse('2026-11-09T10:00:00.000Z'); // 12:00 Harare
const MONTH = toMonthKey(T);
const shift = (userId: string, start: number, end: number, creatorIds = ['noah']) => ({ userId, creatorIds, occurrenceStart: start, occurrenceEnd: end });

const input = (txId: string, over: Partial<LedgerSaleInput['tx']> = {}): LedgerSaleInput => ({
  platformAccountId: '409603086',
  creatorId: 'noah',
  creatorName: 'Noah Ryder',
  txId,
  tx: { t: T, fan: '111', type: 'Payment for message', cat: 'message', status: 'loading', gross: 70, net: 56, ...over },
});
const idOf = (txId: string) => omSaleId('409603086', txId);
const run = (inputs: LedgerSaleInput[], occurrences = [shift('ayo', T - 4 * H, T + 4 * H)], extra: Partial<Parameters<typeof planPay>[0]> = {}, departures?: Map<string, number>) => {
  const attributions = attributeAll(inputs.map(i => ({ saleId: idOf(i.txId), creatorId: i.creatorId, occurredAtMs: i.tx.t })), occurrences, departures);
  return planPay({ inputs, stored: new Map(), attributions, chargebacks: [], finalized: new Set(), ...extra });
};

describe('strict attribution (D2)', () => {
  it('credits the one agent on shift', () => {
    const p = run([input('a')]);
    expect(p.upserts[0].sale).toMatchObject({ sourceUserId: 'ayo', userId: 'ayo', attributedBy: 'schedule', kind: 'ppv', type: 'ppv', grossRevenue: 70, netRevenue: 56 });
  });

  it('leaves nobody-on-shift unassigned, with no fallback', () => {
    expect(run([input('a')], []).upserts[0].sale).toMatchObject({ sourceUserId: null, userId: null, attributedBy: 'unscheduled' });
  });

  it('leaves overlapping shifts unassigned and keeps the candidates', () => {
    const s = run([input('a')], [shift('ayo', T - H, T + H), shift('dami', T - H, T + H)]).upserts[0].sale;
    expect(s).toMatchObject({ sourceUserId: null, attributedBy: 'overlap', scheduledUids: ['ayo', 'dami'] });
  });

  it('gives a handover instant to the incoming shift (half-open intervals), never a tie', () => {
    const s = run([input('a')], [shift('ayo', T - 8 * H, T), shift('dami', T, T + 8 * H)]).upserts[0].sale;
    expect(s).toMatchObject({ sourceUserId: 'dami', attributedBy: 'schedule' });
  });

  it('has no grace window: a minute after a shift ends is unscheduled', () => {
    expect(run([input('a')], [shift('ayo', T - 8 * H, T - 60_000)]).upserts[0].sale.attributedBy).toBe('unscheduled');
  });

  it('only matches the shift on the same account (sub-accounts compare directly, rule 9h)', () => {
    expect(run([input('a')], [shift('ayo', T - H, T + H, ['noah-fansly'])]).upserts[0].sale.attributedBy).toBe('unscheduled');
  });
});

describe('departed agents (D8)', () => {
  it('clamps a shift that began before departure to the departure instant', () => {
    const occ = clampDeparted([shift('ayo', T - 4 * H, T + 4 * H)], new Map([['ayo', T - H]]));
    expect(occ[0].occurrenceEnd).toBe(T - H);
  });

  it('credits nobody after departure, and says why', () => {
    const s = run([input('a')], [shift('ayo', T - 4 * H, T + 4 * H)], {}, new Map([['ayo', T - H]])).upserts[0].sale;
    expect(s).toMatchObject({ sourceUserId: null, attributedBy: 'departed' });
  });

  it('still credits a sale before the departure', () => {
    const s = run([input('a', { t: T - 2 * H })], [shift('ayo', T - 4 * H, T + 4 * H)], {}, new Map([['ayo', T - H]])).upserts[0].sale;
    expect(s.sourceUserId).toBe('ayo');
  });
});

describe('what reaches pay (D3, D16)', () => {
  it('derives tips and PPV only', () => {
    const p = run([
      input('tip', { type: 'Tip from', cat: 'tip' }),
      input('sub', { type: 'Subscription', cat: 'subscription' }),
      input('post', { type: 'Post purchase', cat: 'post' }),
      input('other', { type: 'Mystery', cat: 'other' }),
    ]);
    expect(p.upserts.map(u => u.sale.saleId)).toEqual([idOf('tip')]);
    expect(p.upserts[0].sale).toMatchObject({ kind: 'tip', type: 'tips' });
  });

  it('counts pending_return and flags it', () => {
    const p = run([input('a', { status: 'pending_return' })]);
    expect(p.upserts).toHaveLength(1);
    expect(p.counts.pendingReturn).toBe(1);
  });
});

describe('carried-over invariants', () => {
  const stored = (over: Partial<StoredOmSale> = {}): Map<string, StoredOmSale> =>
    new Map([[idOf('a'), { saleId: idOf('a'), userId: 'ayo', month: MONTH, transfer: null, removed: false, syncHash: null, vanishedAfterFinalise: false, ...over }]]);

  it('writes nothing for an unchanged row', () => {
    const first = run([input('a')]);
    const p = run([input('a')], undefined, { stored: stored({ syncHash: first.upserts[0].sale.syncHash }) });
    expect(p.upserts).toHaveLength(0);
    expect(p.counts.unchanged).toBe(1);
  });

  it('never clears a transfer, and flags a schedule that now disagrees with it', () => {
    const p = run([input('a')], [shift('dami', T - H, T + H)], {
      stored: stored({ userId: 'queen', transfer: { toUserId: 'queen', sourceUserIdAtTransfer: 'ayo' } }),
    });
    expect(p.upserts[0].sale).toMatchObject({ sourceUserId: 'dami', userId: 'queen', attributionConflict: true });
  });

  it('refuses a change inside a month finalised for the stored or the new holder', () => {
    const p = run([input('a')], [shift('dami', T - H, T + H)], { stored: stored(), finalized: new Set([pairKey('ayo', MONTH)]) });
    expect(p.upserts).toHaveLength(0);
    expect(p.rejectedFinalized).toEqual([{ saleId: idOf('a'), months: [MONTH] }]);
  });
});

describe('chargebacks (D17)', () => {
  const cb = (over: Partial<ChargebackInput> = {}): ChargebackInput => ({
    chargebackId: 'cb1',
    amount: 70,
    category: 'message',
    chargebackAtMs: T + 24 * H,
    originalSaleId: idOf('a'),
    preCutoverOriginal: null,
    fanId: '111',
    creatorId: 'noah',
    creatorName: 'Noah Ryder',
    ...over,
  });
  const storedA = (over: Partial<StoredOmSale> = {}) =>
    new Map<string, StoredOmSale>([[idOf('a'), { saleId: idOf('a'), userId: 'ayo', month: MONTH, transfer: null, removed: false, syncHash: 'x', vanishedAfterFinalise: false, ...over }]]);

  it('removes the original when its transaction vanished, and writes no chargeback row', () => {
    const p = run([input('a', { removedAt: T + 24 * H, chargedBackAt: T + 24 * H })], undefined, { stored: storedA(), chargebacks: [cb()] });
    expect(p.removals).toEqual([idOf('a')]);
    expect(p.upserts).toHaveLength(0);
  });

  it('inside a finalised month keeps the original counting and deducts on the chargeback day', () => {
    const nextMonth = Date.parse('2026-12-03T10:00:00.000Z');
    const p = run([input('a', { removedAt: nextMonth })], undefined, {
      stored: storedA(),
      chargebacks: [cb({ chargebackAtMs: nextMonth })],
      finalized: new Set([pairKey('ayo', MONTH)]),
    });
    expect(p.removals).toHaveLength(0);
    expect(p.vanishedFlags).toEqual([idOf('a')]);
    expect(p.upserts[0].sale).toMatchObject({ saleId: omChargebackSaleId('cb1'), status: 'reverse', signedGross: -70, userId: 'ayo', month: '2026-12', reversesSaleId: idOf('a') });
  });

  it('refuses the chargeback row too when its own month is finalised', () => {
    const p = run([input('a', { removedAt: T + H })], undefined, { stored: storedA(), chargebacks: [cb({ chargebackAtMs: T + H })], finalized: new Set([pairKey('ayo', MONTH)]) });
    expect(p.upserts).toHaveLength(0);
    expect(p.rejectedFinalized[0].saleId).toBe(omChargebackSaleId('cb1'));
  });

  it('deducts a pre-cutover original (bx-* / Infloww), which is never modified, from its current holder', () => {
    const p = run([], undefined, { chargebacks: [cb({ originalSaleId: null, preCutoverOriginal: { saleId: 'bx-ppv-1', userId: 'queen', month: '2026-11' } })] });
    expect(p.upserts[0].sale).toMatchObject({ signedGross: -70, userId: 'queen', reversesSaleId: 'bx-ppv-1' });
  });

  it('writes nothing for a chargeback on a subscription', () => {
    const p = run([], undefined, { chargebacks: [cb({ category: 'subscription', originalSaleId: null, preCutoverOriginal: { saleId: 'x', userId: 'q', month: MONTH } })] });
    expect(p.upserts).toHaveLength(0);
  });
});
