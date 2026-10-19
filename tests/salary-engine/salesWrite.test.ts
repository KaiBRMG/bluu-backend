/**
 * The BuddyX sales planner — the money path.
 *
 * Pins the four guarantees the sync rests on (documentation/buddyx.md §3.3):
 * the cutover, the attribution invariant (a sync never clears a transfer), the
 * finalised guard, and the vanished-row guard (nothing is removed on a partial
 * fetch, or inside a finalised month).
 */
import {
  creditableBuddyxUid,
  normalisePpv,
  normaliseTip,
  pairKey,
  planSalesSync,
  resolveSaleIdentities,
  saleMatchKey,
  tipSaleId,
  type ChatterRef,
  type ModelRef,
  type NormalisedSale,
  type StoredSale,
} from '@/lib/buddyx/salesPlan';
import { SALES_CUTOVER_AT, salesSourceFor } from '@/lib/salary/salaryConstants';
import {
  matchSalesToSchedule,
  SCHEDULE_GRACE_MS,
  withoutDeparted,
  type Departures,
  type ScheduleOccurrence,
} from '@/lib/salary/scheduleMatch';
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

/** The schedule map the sync builds: `matchSalesToSchedule` with userId = BuddyX's attribution. */
function scheduleFor(sales: NormalisedSale[], shifts: ScheduleOccurrence[], departures?: Departures) {
  return matchSalesToSchedule(
    sales.map(s => ({
      saleId: s.saleId,
      userId: creditableBuddyxUid(s, chatters, departures),
      creatorId: (s.modelId && models.get(s.modelId)?.creatorId) || null,
      occurredAt: new Date(s.occurredAtMs).toISOString(),
      removedAt: null,
    })),
    withoutDeparted(shifts, departures),
  );
}

function plan(
  sales: NormalisedSale[],
  stored: StoredSale[] = [],
  opts: { finalized?: string[]; complete?: boolean; shifts?: ScheduleOccurrence[]; departures?: Departures } = {},
) {
  const storedMap = new Map(stored.map(s => [s.saleId, s]));
  const identity = resolveSaleIdentities(sales, storedMap);
  return planSalesSync({
    identity,
    stored: storedMap,
    chatters,
    models,
    schedule: opts.shifts ? scheduleFor(identity.sales, opts.shifts, opts.departures) : undefined,
    departures: opts.departures,
    finalized: new Set(opts.finalized ?? []),
    complete: opts.complete ?? true,
  });
}

function storedFrom(sale: NormalisedSale, over: Partial<StoredSale> = {}): StoredSale {
  const first = plan([sale]).upserts[0].sale;
  return {
    saleId: sale.saleId,
    sourceId: sale.sourceId,
    kind: sale.kind,
    matchKey: saleMatchKey(sale),
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

describe('attribution by the shift schedule', () => {
  const at = SALES_CUTOVER_AT + 3_600_000;
  const H = 3_600_000;
  const shift = (userId: string, start: number, end: number, creatorIds = ['c-adam']) => ({
    userId, creatorIds, occurrenceStart: start, occurrenceEnd: end,
  });

  it('credits a PPV to the agent on shift, not its sender', () => {
    const ppv = normalisePpv({
      id: 'p1', modelId: 'm1', modelHandle: 'adamh', fanId: 1, chatterId: 101, chatterName: 'Queen',
      revenue: { gross: 20, net: 16 }, unlockDate: AFTER, createdAt: null,
    }) as NormalisedSale;
    const p = plan([ppv], [], { shifts: [shift('u-jen', at - H, at + H)] });
    expect(p.upserts[0].sale).toMatchObject({
      userId: 'u-jen', sourceUserId: 'u-jen', buddyxUserId: 'u-queen', attributedBy: 'schedule', attributionConflict: false,
    });
    expect(p.counts.scheduleAttributed).toBe(1);
    expect(p.touched).toEqual(new Set([pairKey('u-jen', MONTH)]));
  });

  it('keeps BuddyX’s chatter when they were on shift on the account (grace included)', () => {
    const onShift = plan([tip()], [], { shifts: [shift('u-queen', at - H, at + H), shift('u-jen', at - H, at + H)] });
    expect(onShift.upserts[0].sale).toMatchObject({ userId: 'u-queen', attributedBy: 'buddyx' });
    const handover = plan([tip()], [], {
      shifts: [shift('u-queen', at - H, at - SCHEDULE_GRACE_MS + 60_000), shift('u-jen', at - 60_000, at + H)],
    });
    expect(handover.upserts[0].sale).toMatchObject({ userId: 'u-queen', attributedBy: 'buddyx' });
  });

  it('keeps BuddyX’s attribution when nobody, or more than one other agent, was scheduled', () => {
    expect(plan([tip()], [], { shifts: [] }).upserts[0].sale).toMatchObject({ userId: 'u-queen', attributedBy: 'buddyx' });
    expect(plan([tip()], [], { shifts: [shift('u-jen', at - H, at + H, ['other'])] }).upserts[0].sale.userId).toBe('u-queen');
    const two = plan([tip()], [], { shifts: [shift('u-jen', at - H, at + H), shift('u-x', at - H, at + H)] });
    expect(two.upserts[0].sale).toMatchObject({ userId: 'u-queen', attributedBy: 'buddyx' });
  });

  it('assigns an unassigned tip and an unmapped chatter’s sale to the agent on shift, still reporting the chatter', () => {
    const shifts = [shift('u-jen', at - H, at + H)];
    expect(plan([tip({ chatterId: null })], [], { shifts }).upserts[0].sale).toMatchObject({ userId: 'u-jen', buddyxUserId: null });
    const unmapped = plan([tip({ chatterId: 999 })], [], { shifts });
    expect(unmapped.upserts[0].sale).toMatchObject({ userId: 'u-jen', unmappedChatterId: '999' });
    expect(unmapped.counts.unassigned).toBe(0);
    expect(unmapped.unmappedChatters.has('999')).toBe(true);
  });

  it('never overrides a transfer, and re-credits on the next run when the schedule is corrected', () => {
    const shifts = [shift('u-jen', at - H, at + H)];
    const moved = storedFrom(tip(), { userId: 'u-x', transfer: { sourceUserIdAtTransfer: 'u-jen', toUserId: 'u-x' } });
    expect(plan([tip()], [moved], { shifts }).upserts[0]?.sale ?? null).toMatchObject({ userId: 'u-x', sourceUserId: 'u-jen' });

    const first = plan([tip()], [], { shifts }).upserts[0].sale;
    const stored = { ...storedFrom(tip()), userId: first.userId, syncHash: first.syncHash };
    expect(plan([tip()], [stored], { shifts }).counts.unchanged).toBe(1);
    const corrected = plan([tip()], [stored], { shifts: [shift('u-queen', at - H, at + H)] });
    expect(corrected.upserts[0].sale).toMatchObject({ userId: 'u-queen', attributedBy: 'buddyx' });
    expect(corrected.touched).toEqual(new Set([pairKey('u-queen', MONTH), pairKey('u-jen', MONTH)]));
  });

  it('never credits an agent who had left: BuddyX’s credit to them is dropped, unassigned when no single agent was on shift', () => {
    const departures: Departures = new Map([['u-queen', at - 7 * 24 * H]]);
    const two = [shift('u-jen', at - H, at + H), shift('u-x', at - H, at + H)];
    const p = plan([tip()], [], { shifts: two, departures });
    expect(p.upserts[0].sale).toMatchObject({ userId: null, sourceUserId: null, buddyxUserId: 'u-queen', attributedBy: 'departed' });
    expect(p.counts).toMatchObject({ departedUnassigned: 1, unassigned: 1 });
    // One agent on shift → theirs, as for any other sale.
    expect(plan([tip()], [], { shifts: [shift('u-jen', at - H, at + H)], departures }).upserts[0].sale).toMatchObject({
      userId: 'u-jen', attributedBy: 'schedule',
    });
    // Nobody scheduled at all → still nobody, never the departed agent.
    expect(plan([tip()], [], { shifts: [], departures }).upserts[0].sale.userId).toBeNull();
  });

  it('drops a departed agent’s leftover shifts, but keeps sales they made before leaving', () => {
    const leftAt = at - H / 2;
    const departures: Departures = new Map([['u-queen', leftAt]]);
    // Queen's recurring shift is still on the roster after she left: it no longer captures the sale.
    const lingering = plan([tip({ chatterId: 102 })], [], { shifts: [shift('u-queen', at - 10 * 60_000, at + H)], departures });
    expect(lingering.upserts[0].sale).toMatchObject({ userId: 'u-jen', attributedBy: 'buddyx' });
    // A sale before she left, on her shift, is still hers.
    const before = normaliseTip(tipRow({ datePurchase: new Date(leftAt - 60_000).toISOString() })) as NormalisedSale;
    const kept = plan([before], [], { shifts: [shift('u-queen', leftAt - 2 * H, leftAt + 4 * H)], departures });
    expect(kept.upserts[0].sale).toMatchObject({ userId: 'u-queen', attributedBy: 'buddyx' });
  });

  it('refuses a schedule re-credit into a finalised month', () => {
    const stored = storedFrom(tip());
    const p = plan([tip()], [stored], { shifts: [shift('u-jen', at - H, at + H)], finalized: [pairKey('u-jen', MONTH)] });
    expect(p.upserts).toHaveLength(0);
    expect(p.counts.rejectedFinalized).toBe(1);
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
    const stored = storedFrom(sale, { userId: 'u-jen', transfer: { sourceUserIdAtTransfer: 'u-queen', toUserId: 'u-jen' } });

    // Same source attribution as when it was transferred → still the filer's, no conflict.
    const same = plan([sale], [stored]);
    expect(same.upserts[0].sale).toMatchObject({ userId: 'u-jen', sourceUserId: 'u-queen', attributionConflict: false });

    // BuddyX now says someone else → the transfer stands, flagged for an admin.
    const moved = plan([tip({ chatterId: 999 })], [stored]);
    expect(moved.upserts[0].sale).toMatchObject({ userId: 'u-jen', attributionConflict: true });
    expect(moved.counts.attributionConflicts).toBe(1);
  });
});

describe('transfers — disputes and admin reassignment', () => {
  it('is not a conflict when BuddyX comes round to the agent Bluu holds it on', () => {
    const stored = storedFrom(tip(), { userId: 'u-jen', transfer: { sourceUserIdAtTransfer: 'u-queen', toUserId: 'u-jen' } });
    const agreed = plan([tip({ chatterId: 102 })], [stored]);
    expect(agreed.upserts[0].sale).toMatchObject({ userId: 'u-jen', sourceUserId: 'u-jen', attributionConflict: false });
  });

  it('compares against BuddyX at the time of the move, not the holder it was moved off', () => {
    // A dispute moved Queen → Jenelle; an admin then moved Jenelle → nobody.
    const stored = storedFrom(tip(), {
      userId: null,
      transfer: { toUserId: null, sourceUserIdAtTransfer: 'u-queen' },
    });
    const p = plan([tip()], [stored]);
    expect(p.upserts[0].sale).toMatchObject({ userId: null, sourceUserId: 'u-queen', attributionConflict: false });
    expect(plan([tip({ chatterId: 102 })], [stored]).upserts[0].sale.attributionConflict).toBe(true);
  });
});

describe('identity — a re-sync updates the right document', () => {
  it('updates the existing document when BuddyX reassigns a sale, keeping its id', () => {
    const p = plan([tip({ chatterId: 102 })], [storedFrom(tip())]);
    expect(p.upserts).toHaveLength(1);
    expect(p.upserts[0]).toMatchObject({ isNew: false, sale: { saleId: tipSaleId('t1'), userId: 'u-jen', sourceUserId: 'u-jen' } });
    expect(p.counts.new).toBe(0);
  });

  it('re-keys when BuddyX gives the same sale a new id, so a transfer survives', () => {
    const stored = storedFrom(tip(), { userId: 'u-jen', transfer: { sourceUserIdAtTransfer: 'u-queen', toUserId: 'u-jen' } });
    const p = plan([tip({ id: 't9', chatterId: 102 })], [stored]);
    expect(p.counts).toMatchObject({ rekeyed: 1, new: 0, removed: 0 });
    expect(p.removals).toEqual([]);
    expect(p.upserts[0].sale).toMatchObject({ saleId: tipSaleId('t1'), sourceId: 't9', userId: 'u-jen' });
    expect(p.rekeyed).toEqual([{ saleId: tipSaleId('t1'), fromSourceId: 't1', toSourceId: 't9' }]);

    // The next run finds it by its new BuddyX id directly.
    const next = plan([tip({ id: 't9', chatterId: 102 })], [{ ...stored, sourceId: 't9', syncHash: p.upserts[0].sale.syncHash }]);
    expect(next.counts).toMatchObject({ unchanged: 1, rekeyed: 0 });
  });

  it('never guesses between two identical sales', () => {
    const a = storedFrom(tip({ id: 'a' }));
    const b = storedFrom(tip({ id: 'b' }));
    const p = plan([tip({ id: 'c' })], [a, b]);
    expect(p.counts).toMatchObject({ rekeyed: 0, rekeyAmbiguous: 1, new: 1, removed: 2 });
  });

  it('never reuses a document id a re-keyed row still holds', () => {
    // Doc bx-tip-t1 now tracks BuddyX id t9; BuddyX hands id t1 to a different sale.
    const kept = { ...storedFrom(tip({ id: 't9' })), saleId: tipSaleId('t1') };
    const p = plan([tip({ id: 't9' }), tip({ id: 't1', amount: { gross: 75, net: 60 } })], [kept]);
    const byId = new Map(p.upserts.map(u => [u.sale.saleId, u]));
    expect(byId.get(tipSaleId('t1'))).toMatchObject({ isNew: false, sale: { sourceId: 't9', grossRevenue: 50 } });
    expect(byId.get(`${tipSaleId('t1')}~2`)).toMatchObject({ isNew: true, sale: { sourceId: 't1', grossRevenue: 75 } });
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
