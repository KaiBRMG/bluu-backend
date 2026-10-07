/**
 * The one error type the BuddyX client throws.
 *
 * Every failure from `api.buddyx.app` arrives in the same envelope
 * (`{ error: { code, message, requestId } }`), so a caller decides what to do
 * from `code` alone. Two codes change what the sync does rather than just
 * failing a step:
 *
 * - `AUTH_INVALID_KEY` — the key is revoked or wrong. **Fatal and alerting**:
 *   every later request would fail the same way, so the run stops and the ops
 *   alert fires (`buddyxSyncFailing`).
 * - `MODEL_INACTIVE` — one creator has not streamed stats for 7 days. **Per
 *   creator and non-fatal**: that creator is skipped and recorded, the rest of
 *   the run carries on.
 */

export class BuddyxError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;

  constructor(code: string, message: string, status: number, requestId: string | null = null) {
    super(`${code}: ${message}`);
    this.name = 'BuddyxError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }

  /** The key itself is unusable — nothing else in the run can succeed. */
  get isFatal(): boolean {
    return this.code === 'AUTH_INVALID_KEY' || this.code === 'AUTH_MISSING' || this.code === 'AUTH_INVALID_SCHEME';
  }

  /** One creator is unavailable; skip it and keep going. */
  get isModelScoped(): boolean {
    return this.code === 'MODEL_INACTIVE' || this.code === 'MODEL_FORBIDDEN' || this.code === 'LINK_NOT_FOUND';
  }
}

export function isBuddyxError(err: unknown): err is BuddyxError {
  return err instanceof BuddyxError;
}
