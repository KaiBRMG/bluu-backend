/**
 * Chargeback → original transaction. Pure (migration plan §5.5).
 *
 * OnlyFans removes a charged-back original from `/transactions` (V5), so the
 * original survives only as our own stored row, usually already vanished. A
 * chargeback carries no original id, only facts: account (implicit), `fan.id`,
 * `type`, `amount` and `transaction_timestamp`, which equals the original's
 * OnlyFans timestamp **exactly** (verified against Infloww rows).
 *
 * **Attach only on a unique match. Never guess (invariant 8).** Zero candidates
 * → `none`, several → `ambiguous`, both surfaced for an admin.
 */
import { categoryOf } from './classify';
import type { DayBucket } from './ledger';

export type ChargebackMatchState = 'matched' | 'none' | 'ambiguous';

export interface ChargebackFacts {
  fanId: string;
  type: string;
  amount: number;
  transactionAtMs: number;
}

export function matchChargeback(cb: ChargebackFacts, bucket: DayBucket | undefined): { state: ChargebackMatchState; txId: string | null } {
  if (!bucket) return { state: 'none', txId: null };
  const cat = categoryOf(cb.type);
  const cents = Math.round(Math.abs(cb.amount) * 100);
  const candidates = Object.entries(bucket).filter(
    ([, row]) =>
      row.t === cb.transactionAtMs &&
      row.fan === cb.fanId &&
      row.cat === cat &&
      row.gross !== null &&
      Math.round(Math.abs(row.gross) * 100) === cents,
  );
  if (candidates.length === 1) return { state: 'matched', txId: candidates[0][0] };
  return { state: candidates.length === 0 ? 'none' : 'ambiguous', txId: null };
}
