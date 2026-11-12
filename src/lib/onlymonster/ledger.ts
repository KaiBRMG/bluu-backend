/**
 * The account ledger, pure (migration plan §6, D20).
 *
 * Every OnlyFans transaction lives in its account-day bucket,
 * `of-transaction-days/{platformAccountId}_{day}`, as `txs[txId]`. A run fetches
 * a window from `/transactions` and **merges** it into the stored buckets:
 *
 * - new or changed rows are written;
 * - a stored row inside a **completely paginated** window that the API no
 *   longer returns is **vanished** (`removedAt`). OnlyFans removes a
 *   charged-back original this way (V5); a matching chargeback then marks it
 *   `chargedBackAt` (see `chargebackMatch.ts`);
 * - a vanished row that reappears is restored.
 *
 * Nothing here reads Firestore or the API. `onlymonsterLedgerService.ts` does
 * the I/O around it.
 */
import { categoryOf, netOf, statusClassOf, type TransactionCategory } from './classify';
import { normaliseId, type OmTransaction } from './types';
import { round2 } from '../salary/salaryEngine';

/** One transaction as stored in its day bucket. Short keys: a busy day holds ~40 of them. */
export interface LedgerTx {
  /** Occurred at, ms. */
  t: number;
  fan: string;
  /** The raw OnlyFans type string, kept verbatim. */
  type: string;
  cat: TransactionCategory;
  status: string;
  /** Gross; null when OnlyFans does not know it (never seen). */
  gross: number | null;
  net: number | null;
  /** Set when the API stopped returning it inside a complete window. */
  removedAt?: number | null;
  /** Set when a chargeback uniquely matched it (it is then also removed). */
  chargedBackAt?: number | null;
  chargebackId?: string | null;
}

export type DayBucket = Record<string, LedgerTx>;

export function toLedgerTx(tx: OmTransaction): { id: string; row: LedgerTx } | null {
  const id = normaliseId(tx.id);
  const t = Date.parse(tx.timestamp);
  if (!id || !Number.isFinite(t)) return null;
  const gross = typeof tx.amount === 'number' && Number.isFinite(tx.amount) ? tx.amount : null;
  return {
    id,
    row: {
      t,
      fan: normaliseId(tx.fan?.id) ?? '',
      type: String(tx.type ?? ''),
      cat: categoryOf(tx.type),
      status: String(tx.status ?? ''),
      gross,
      net: gross === null ? null : netOf(gross),
    },
  };
}

function sameRow(a: LedgerTx | undefined, b: LedgerTx): boolean {
  if (!a) return false;
  return (
    a.t === b.t &&
    a.fan === b.fan &&
    a.type === b.type &&
    a.cat === b.cat &&
    a.status === b.status &&
    a.gross === b.gross &&
    a.net === b.net &&
    (a.removedAt ?? null) === (b.removedAt ?? null) &&
    (a.chargedBackAt ?? null) === (b.chargedBackAt ?? null) &&
    (a.chargebackId ?? null) === (b.chargebackId ?? null)
  );
}

export interface MergeResult {
  /** The merged bucket per day, for every day that changed. */
  changed: Map<string, DayBucket>;
  counts: { added: number; updated: number; vanished: number; restored: number };
}

/**
 * Merge one fetched window into the stored buckets.
 *
 * @param fetched  every transaction the API returned for [windowStart, windowEnd]
 * @param stored   the stored buckets for every day the window touches (missing = empty)
 * @param dayOf    ms → salary day key (Africa/Harare)
 * @param complete whether the window paginated to completion. **Vanishing only
 *                 happens on a complete window**; an interrupted fetch never
 *                 removes anything.
 */
export function mergeWindow(params: {
  fetched: OmTransaction[];
  stored: Map<string, DayBucket>;
  windowStart: number;
  windowEnd: number;
  complete: boolean;
  dayOf: (ms: number) => string;
  now: number;
}): MergeResult {
  const { fetched, stored, windowStart, windowEnd, complete, dayOf, now } = params;
  const counts = { added: 0, updated: 0, vanished: 0, restored: 0 };
  const next = new Map<string, DayBucket>();
  const touched = new Set<string>();
  const bucketFor = (day: string): DayBucket => {
    let b = next.get(day);
    if (!b) {
      b = { ...(stored.get(day) ?? {}) };
      next.set(day, b);
    }
    return b;
  };

  const seen = new Set<string>();
  for (const raw of fetched) {
    const parsed = toLedgerTx(raw);
    if (!parsed) continue;
    const { id, row } = parsed;
    if (seen.has(id)) continue; // windows are inclusive at both ends; dedupe by id
    seen.add(id);
    const day = dayOf(row.t);
    const bucket = bucketFor(day);
    const prev = bucket[id];
    // A reappearing row is restored, and its chargeback link is dropped with the removal.
    const merged: LedgerTx = { ...row, removedAt: null, chargedBackAt: null, chargebackId: null };
    if (!prev) counts.added += 1;
    else if (prev.removedAt) counts.restored += 1;
    if (!sameRow(prev, merged)) {
      if (prev && !prev.removedAt) counts.updated += 1;
      bucket[id] = merged;
      touched.add(day);
    }
  }

  if (complete) {
    for (const [day, bucket] of stored) {
      for (const [id, prev] of Object.entries(bucket)) {
        if (seen.has(id) || prev.removedAt) continue;
        if (prev.t < windowStart || prev.t > windowEnd) continue;
        bucketFor(day)[id] = { ...prev, removedAt: now };
        counts.vanished += 1;
        touched.add(day);
      }
    }
  }

  const changed = new Map<string, DayBucket>();
  for (const day of touched) changed.set(day, next.get(day)!);
  return { changed, counts };
}

/** The stable id of an account-day bucket. */
export function bucketId(platformAccountId: string, day: string): string {
  return `${platformAccountId}_${day}`;
}


export interface DayTotals {
  totalGross: number;
  totalNet: number;
  subsGross: number;
  tipsGross: number;
  messagesGross: number;
  postsGross: number;
  streamGross: number;
  otherGross: number;
  subsNet: number;
  tipsNet: number;
  messagesNet: number;
  txCount: number;
  spenders: number;
  heldGross: number;
  pendingReturnGross: number;
  unknownTypeCount: number;
}

/**
 * One account-day's money, from its bucket. Removed rows are excluded, which is
 * also how OnlyFans' own overview totals behave (V5: `/overview-metrics` equals
 * the transactions it still returns). Net is summed from per-transaction net
 * (V3). Recomputed from scratch every time, so it never drifts.
 */
export function totalsOf(bucket: DayBucket): DayTotals {
  const t: DayTotals = {
    totalGross: 0, totalNet: 0, subsGross: 0, tipsGross: 0, messagesGross: 0, postsGross: 0, streamGross: 0, otherGross: 0,
    subsNet: 0, tipsNet: 0, messagesNet: 0, txCount: 0, spenders: 0, heldGross: 0, pendingReturnGross: 0, unknownTypeCount: 0,
  };
  const fans = new Set<string>();
  for (const row of Object.values(bucket)) {
    if (row.removedAt) continue;
    const g = row.gross ?? 0;
    const n = row.net ?? 0;
    t.txCount += 1;
    t.totalGross += g;
    t.totalNet += n;
    if (g > 0 && row.fan) fans.add(row.fan);
    const status = statusClassOf(row.status);
    if (status === 'held') t.heldGross += g;
    if (status === 'pending-return') t.pendingReturnGross += g;
    switch (row.cat) {
      case 'subscription':
      case 'renewal':
        t.subsGross += g;
        t.subsNet += n;
        break;
      case 'tip':
        t.tipsGross += g;
        t.tipsNet += n;
        break;
      case 'message':
        t.messagesGross += g;
        t.messagesNet += n;
        break;
      case 'post':
        t.postsGross += g;
        break;
      case 'stream':
        t.streamGross += g;
        break;
      default:
        t.otherGross += g;
        t.unknownTypeCount += 1;
    }
  }
  for (const k of Object.keys(t) as (keyof DayTotals)[]) if (k !== 'txCount' && k !== 'spenders' && k !== 'unknownTypeCount') t[k] = round2(t[k]);
  t.spenders = fans.size;
  return t;
}
