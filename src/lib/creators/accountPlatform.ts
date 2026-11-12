/**
 * Which platform a creator account or sub-account lives on.
 *
 * Plain data, safe to import from client code (the Creator Management form
 * renders the options) and from the server (the routes validate against it).
 *
 * **Why it exists:** a creator's handle is often the same on every platform.
 * Noah Ryder is `@itsnoahryder` on OnlyFans *and* on Fansly, so matching an
 * OnlyFans account by handle alone finds two Bluu accounts and maps to nobody.
 * The OnlyMonster mapping matches only against `platform: 'onlyfans'` accounts
 * (onlymonster-migration.md §4.2), which makes that collision impossible.
 *
 * The field is **required on every new account**. A legacy document without it
 * is never matched to an OnlyFans account: guessing a platform would be guessing
 * whose pay a sale lands in. `scripts/backfill-account-platform.js` set it on
 * every account that existed when the field was introduced (2026-11-11).
 */

export const ACCOUNT_PLATFORMS = ['onlyfans', 'fansly', 'justforfans', 'other'] as const;
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number];

export const ACCOUNT_PLATFORM_LABEL: Record<AccountPlatform, string> = {
  onlyfans: 'OnlyFans',
  fansly: 'Fansly',
  justforfans: 'JustFor.Fans',
  other: 'Other',
};

export function isAccountPlatform(value: unknown): value is AccountPlatform {
  return typeof value === 'string' && (ACCOUNT_PLATFORMS as readonly string[]).includes(value);
}

/** The platform the OnlyMonster sync maps to. Every other value is excluded. */
export const ONLYFANS_PLATFORM: AccountPlatform = 'onlyfans';

/**
 * The `platform` field of a create / update body, validated once for every creator route.
 * `undefined` → `{ ok: true, value: undefined }` (absent: leave unset / unchanged).
 * TEMPORARY (rule 9c): a renderer on the pre-2026-11-11 bundle sends no platform when it
 * creates an account; that is accepted and stored unset. Once DeploymentRefresher has cycled
 * the fleet, the create routes can pass `required: true`.
 */
export function parsePlatformField(value: unknown, opts: { required?: boolean } = {}): { ok: true; value: AccountPlatform | undefined } | { ok: false; error: string } {
  if (value === undefined) return opts.required ? { ok: false, error: 'Choose the platform this account is on.' } : { ok: true, value: undefined };
  return isAccountPlatform(value) ? { ok: true, value } : { ok: false, error: 'Unknown platform.' };
}
