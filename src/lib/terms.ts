/**
 * The version of the Terms of Use & Privacy Policy currently published at
 * `/terms` — the SINGLE place it is declared.
 *
 * ── Bumping it signs the whole organisation out ──────────────────────────────
 * Every login stamps `users/{uid}.acceptedTermsVersion` with the version the
 * server holds at that moment (`recordSuccessfulLogin`, `/api/auth/session-token`).
 * `TermsUpdateSignOut` then ends the session of anyone whose stamp is behind
 * this value — but only while they are clocked out AND have been inactive in the
 * window for a while (see that component). They land on `/auth/terms-updated`,
 * and signing back in is their acceptance of the new text, exactly as the notice
 * on `Login` already says.
 *
 * So **bump `TERMS_VERSION` only for a substantive edit** — the same bar the
 * rule at the top of `app/terms/page.tsx` already sets. A typo fix must not
 * sign out a company. Bump `TERMS_EFFECTIVE_DATE` with it.
 *
 * Both values are server-held truth. A renderer weeks old must never compare
 * against a copy compiled into its own bundle (rule 9c), so the client reads the
 * required version from `GET /api/terms/version` instead of importing this.
 */
export const TERMS_VERSION = '3.0';
export const TERMS_EFFECTIVE_DATE = 'November 12, 2026';

/** `"3.0"` → `[3, 0]`; `null` for anything that is not dot-separated integers. */
function parseVersion(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const nums = parts.map((p) => (/^\d{1,6}$/.test(p) ? Number(p) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

/**
 * Has this user NOT signed in under the required version?
 *
 *  - No stamp at all (a user from before this existed) → **yes**: they have
 *    never signed in under any published version, so they are signed out once.
 *  - An unparseable `required` → **no**. Fail safe: a malformed answer must
 *    never sign anybody out.
 *  - Strictly older than required → yes. Equal or NEWER → no, so rolling a
 *    deployment back to an earlier text does not sign out everyone who had
 *    already accepted the later one.
 */
export function termsAcceptanceIsStale(required: unknown, accepted: unknown): boolean {
  const req = parseVersion(required);
  if (!req) return false;
  const acc = parseVersion(accepted);
  if (!acc) return true;
  for (let i = 0; i < Math.max(req.length, acc.length); i++) {
    const r = req[i] ?? 0;
    const a = acc[i] ?? 0;
    if (a !== r) return a < r;
  }
  return false;
}
