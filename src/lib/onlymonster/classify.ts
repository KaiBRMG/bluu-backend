/**
 * OnlyFans transaction `type` / `status` → what Bluu does with it. Pure.
 *
 * The strings are free text documented per platform, and a platform may add
 * new ones at any time (OnlyMonsterAPI.md). Seen in the Phase 0 probe (V1):
 * `Tip from` (literal, no name), `Payment for message`, `Subscription`,
 * `Recurring subscription`. Documented but not yet seen: `Post purchase`,
 * `Live stream`, `Unknown`, `unknown`.
 *
 * **No guessing on money (invariant 8).** Anything not listed lands in `other`:
 * it is counted in the account ledger and surfaced, and it is never a tip or a
 * PPV. Matching is exact after trimming and case-folding. A prefix match would
 * file a hypothetical "Tip from campaign refund" as a tip.
 */

export type TransactionCategory = 'subscription' | 'renewal' | 'tip' | 'message' | 'post' | 'stream' | 'other';

/** The two categories that can become a `ca-sales` row (D3). */
export type PayKind = 'tip' | 'ppv';

const TYPE_CATEGORY: Record<string, TransactionCategory> = {
  'subscription': 'subscription',
  'recurring subscription': 'renewal',
  'tip from': 'tip',
  'payment for message': 'message',
  'post purchase': 'post',
  'live stream': 'stream',
};

export function categoryOf(rawType: string | null | undefined): TransactionCategory {
  const key = String(rawType ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return TYPE_CATEGORY[key] ?? 'other';
}

/** The pay kind for a category, or null when it never reaches `ca-sales` (D3: tips + PPV messages only). */
export function payKindOf(category: TransactionCategory): PayKind | null {
  if (category === 'tip') return 'tip';
  if (category === 'message') return 'ppv';
  return null;
}

export type StatusClass = 'settled' | 'held' | 'pending-return' | 'unknown';

/**
 * `done` is settled. `loading` is OnlyFans' ~7-day payout hold (V4: every
 * row two days old is `loading`, every row three weeks old is `done`).
 * `pending_return` is a return in progress. Anything else is `unknown` and is
 * surfaced. Whether each class counts toward commission is P1, a pay policy
 * decided in Phase 4; this function only names the class.
 */
export function statusClassOf(rawStatus: string | null | undefined): StatusClass {
  const s = String(rawStatus ?? '').trim().toLowerCase();
  if (s === 'done') return 'settled';
  if (s === 'loading') return 'held';
  if (s === 'pending_return') return 'pending-return';
  return 'unknown';
}

export interface Classification {
  category: TransactionCategory;
  payKind: PayKind | null;
  statusClass: StatusClass;
}

export function classifyTransaction(tx: { type: string | null | undefined; status: string | null | undefined }): Classification {
  const category = categoryOf(tx.type);
  return { category, payKind: payKindOf(category), statusClass: statusClassOf(tx.status) };
}

/**
 * Net per transaction, the way OnlyFans rounds it (V3): `round2(gross × 0.8)`
 * per row, then summed. Summing first and rounding once was 2 cents off on
 * both days probed.
 */
export function netOf(gross: number): number {
  return Math.round(gross * 0.8 * 100) / 100;
}
