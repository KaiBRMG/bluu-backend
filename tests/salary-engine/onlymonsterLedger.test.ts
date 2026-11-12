/**
 * The account ledger merge (migration plan §6, D20) and chargeback matching (§5.5).
 * The two money rules pinned here: a row is only ever vanished on a window that
 * paginated to completion, and a chargeback attaches only on a unique match.
 */
import { bucketId, mergeWindow, totalsOf, type DayBucket } from '@/lib/onlymonster/ledger';
import { matchChargeback } from '@/lib/onlymonster/chargebackMatch';
import { toDayKey } from '@/lib/salary/salaryDate';
import type { OmTransaction } from '@/lib/onlymonster/types';

const T0 = Date.parse('2026-11-09T10:00:00.000Z');
const tx = (id: string, at: number, type = 'Tip from', amount: number | null = 10, status = 'loading', fan = '111'): OmTransaction => ({
  id,
  amount,
  fan: { id: fan },
  type,
  status,
  timestamp: new Date(at).toISOString(),
});
const DAY = toDayKey(T0);
const W = { windowStart: T0 - 3600_000, windowEnd: T0 + 3600_000, dayOf: toDayKey, now: T0 + 7200_000 };

describe('mergeWindow', () => {
  it('adds new rows into their Harare day bucket, deduping the inclusive-boundary repeat', () => {
    const r = mergeWindow({ ...W, fetched: [tx('a', T0), tx('a', T0), tx('b', T0 + 60_000, 'Payment for message', 60)], stored: new Map(), complete: true });
    expect(r.counts.added).toBe(2);
    expect(Object.keys(r.changed.get(DAY)!)).toEqual(['a', 'b']);
    expect(r.changed.get(DAY)!.b).toMatchObject({ cat: 'message', gross: 60, net: 48 });
  });

  it('writes nothing for an unchanged window', () => {
    const first = mergeWindow({ ...W, fetched: [tx('a', T0)], stored: new Map(), complete: true });
    const again = mergeWindow({ ...W, fetched: [tx('a', T0)], stored: first.changed, complete: true });
    expect(again.changed.size).toBe(0);
  });

  it('records a status change in place (loading → done keeps the id)', () => {
    const first = mergeWindow({ ...W, fetched: [tx('a', T0)], stored: new Map(), complete: true });
    const r = mergeWindow({ ...W, fetched: [tx('a', T0, 'Tip from', 10, 'done')], stored: first.changed, complete: true });
    expect(r.counts.updated).toBe(1);
    expect(r.changed.get(DAY)!.a.status).toBe('done');
  });

  it('vanishes a row missing from a COMPLETE window, and restores it when it returns', () => {
    const first = mergeWindow({ ...W, fetched: [tx('a', T0), tx('b', T0)], stored: new Map(), complete: true });
    const gone = mergeWindow({ ...W, fetched: [tx('a', T0)], stored: first.changed, complete: true });
    expect(gone.counts.vanished).toBe(1);
    expect(gone.changed.get(DAY)!.b.removedAt).toBe(W.now);
    const back = mergeWindow({ ...W, fetched: [tx('a', T0), tx('b', T0)], stored: gone.changed, complete: true });
    expect(back.counts.restored).toBe(1);
    expect(back.changed.get(DAY)!.b.removedAt).toBeNull();
  });

  it('never vanishes anything on an incomplete window', () => {
    const first = mergeWindow({ ...W, fetched: [tx('a', T0), tx('b', T0)], stored: new Map(), complete: true });
    const r = mergeWindow({ ...W, fetched: [tx('a', T0)], stored: first.changed, complete: false });
    expect(r.counts.vanished).toBe(0);
    expect(r.changed.size).toBe(0);
  });

  it('never vanishes a row outside the fetched window', () => {
    const old = mergeWindow({ ...W, fetched: [tx('old', T0 - 2 * 3600_000)], stored: new Map(), complete: true, windowStart: 0 });
    const r = mergeWindow({ ...W, fetched: [], stored: old.changed, complete: true });
    expect(r.counts.vanished).toBe(0);
  });
});

describe('totalsOf', () => {
  it('excludes removed rows and splits by category, net per transaction', () => {
    const bucket: DayBucket = {
      a: { t: T0, fan: '1', type: 'Subscription', cat: 'subscription', status: 'done', gross: 9.99, net: 7.99 },
      b: { t: T0, fan: '2', type: 'Recurring subscription', cat: 'renewal', status: 'loading', gross: 9.99, net: 7.99 },
      c: { t: T0, fan: '2', type: 'Tip from', cat: 'tip', status: 'pending_return', gross: 20, net: 16 },
      d: { t: T0, fan: '3', type: 'Payment for message', cat: 'message', status: 'done', gross: 70, net: 56, removedAt: 1 },
      e: { t: T0, fan: '4', type: 'Mystery', cat: 'other', status: 'done', gross: 5, net: 4 },
    };
    expect(totalsOf(bucket)).toMatchObject({
      totalGross: 44.98,
      totalNet: 35.98,
      subsGross: 19.98,
      tipsGross: 20,
      messagesGross: 0,
      otherGross: 5,
      txCount: 4,
      spenders: 3,
      heldGross: 9.99,
      pendingReturnGross: 20,
      unknownTypeCount: 1,
    });
  });
});

describe('matchChargeback', () => {
  const bucket: DayBucket = {
    x: { t: T0, fan: '241756784', type: 'Payment for message', cat: 'message', status: 'done', gross: 70, net: 56, removedAt: 5 },
    y: { t: T0, fan: '241756784', type: 'Tip from', cat: 'tip', status: 'done', gross: 70, net: 56 },
  };
  const cb = { fanId: '241756784', type: 'Payment for message', amount: 70, transactionAtMs: T0 };

  it('attaches on the exact instant, fan, category and amount', () => {
    expect(matchChargeback(cb, bucket)).toEqual({ state: 'matched', txId: 'x' });
  });

  it('never attaches on a near-miss', () => {
    expect(matchChargeback({ ...cb, transactionAtMs: T0 + 1000 }, bucket).state).toBe('none');
    expect(matchChargeback({ ...cb, amount: 69.99 }, bucket).state).toBe('none');
    expect(matchChargeback({ ...cb, fanId: '9' }, bucket).state).toBe('none');
    expect(matchChargeback(cb, undefined).state).toBe('none');
  });

  it('refuses two candidates', () => {
    const twin = { ...bucket, z: { ...bucket.x } };
    expect(matchChargeback(cb, twin)).toEqual({ state: 'ambiguous', txId: null });
  });
});

describe('bucketId', () => {
  it('is the platform account id and the day', () => {
    expect(bucketId('409603086', '2026-11-09')).toBe('409603086_2026-11-09');
  });
});
