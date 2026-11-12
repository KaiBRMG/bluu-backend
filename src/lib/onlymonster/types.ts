/**
 * OnlyMonster wire types — what `omapi.onlymonster.ai` sends, as documented in
 * OnlyMonsterAPI.md (om-api-service v0.77.0) and confirmed by the Phase 0 probe
 * (onlymonster-migration.md §11).
 *
 * **Every id is normalised to a string** (`normaliseId`). The API is
 * inconsistent: an account `id` and a `/users/metrics` `user_id` are integers,
 * a mass message's `created_by.id` is a string, and a Fansly
 * `platform_account_id` exceeds 2^53, so it must never pass through `Number()`.
 */

export function normaliseId(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  return null;
}

/** `GET /api/v0/accounts` item. */
export interface OmAccount {
  id: number | string;
  /** Big-int string. The numeric OnlyFans account id — stable across handle changes. */
  platform_account_id: string;
  /** `'onlyfans'` | `'fansly'` | anything a later platform adds. */
  platform: string;
  name: string;
  email: string | null;
  avatar: string;
  username: string;
  organisation_id: string;
  subscribe_price: number | null;
  subscription_expiration_date: string | null;
  custom_label: string | null;
}

/** `GET /api/v0/members` item. Offset-paged, `limit` ≤ 50. */
export interface OmMember {
  id: number;
  avatar: string | null;
  name: string;
  email: string;
  createdAt: string;
  customName: string | null;
}

/** `GET …/transactions` item (newest first; both `start` and `end` are inclusive). */
export interface OmTransaction {
  /** 32 hex characters. */
  id: string;
  /** Gross. Null when the platform does not know it (never seen in the probe). */
  amount: number | null;
  fan: { id: string };
  /** Free string, see `classify.ts`. */
  type: string;
  /** `done` · `loading` (the ~7-day payout hold) · `pending_return`. Free string. */
  status: string;
  /** Whole seconds, `.000Z`. */
  timestamp: string;
}

/** `GET …/chargebacks` item. The charged-back original is NOT returned by `/transactions` (V5). */
export interface OmChargeback {
  id: string;
  /** Positive. */
  amount: number;
  fan: { id: string };
  /** The original's transaction type string (`Tip from`, `Payment for message`, `Subscription`). */
  type: string;
  /** `undo` on every chargeback seen — the normal state, not a reversal. */
  status: string;
  chargeback_timestamp: string;
  /** Exactly the original's OnlyFans timestamp (verified against Infloww rows). */
  transaction_timestamp: string;
}

