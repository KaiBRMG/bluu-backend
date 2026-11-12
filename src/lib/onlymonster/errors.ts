/**
 * The one error type the OnlyMonster client throws.
 *
 * OnlyMonster's error body carries a `code` (e.g. `API_KEY_PERMISSION_DENIED`)
 * and, for a permission miss, `details.required_permission`. A caller decides
 * what to do from `isFatal` alone:
 *
 * - **Fatal** — the key is missing, wrong or revoked (401), or lacks a
 *   permission a stage needs (403 `API_KEY_PERMISSION_DENIED`). Every later
 *   request would fail the same way, so the run stops and the ops alert fires.
 *   A permission miss names the permission, so the alert can say what to grant.
 * - Everything else fails the stage it happened in and the run carries on.
 */

export class OnlyMonsterError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requiredPermission: string | null;

  constructor(code: string, message: string, status: number, requiredPermission: string | null = null) {
    super(`${code}: ${message}`);
    this.name = 'OnlyMonsterError';
    this.code = code;
    this.status = status;
    this.requiredPermission = requiredPermission;
  }

  get isFatal(): boolean {
    return this.code === 'AUTH_MISSING' || this.status === 401 || this.code === 'API_KEY_PERMISSION_DENIED';
  }

  /** A sentence for the ops alert. */
  get alertReason(): string {
    if (this.code === 'AUTH_MISSING') return 'ONLYMONSTER_API_KEY is not set on the server.';
    if (this.code === 'API_KEY_PERMISSION_DENIED') {
      return `The OnlyMonster API key lacks the "${this.requiredPermission ?? 'unknown'}" permission.`;
    }
    if (this.status === 401) return 'The OnlyMonster API key was rejected (revoked or wrong). Issue a new key and set ONLYMONSTER_API_KEY.';
    return this.message;
  }
}

export function isOnlyMonsterError(err: unknown): err is OnlyMonsterError {
  return err instanceof OnlyMonsterError;
}
