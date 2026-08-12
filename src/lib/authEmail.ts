/**
 * Email normalisation for the login allowlist.
 *
 * Since the personal-email migration, the address on `users/{uid}.workEmail` is
 * the **authorisation key**: an admin registers it up-front, and login is
 * refused unless the address Google hands back matches a registered user. That
 * makes string equality a security-relevant decision, and plain `===` is wrong
 * in two ways:
 *
 *  1. **Case.** Google returns a canonical lower-cased address, but an admin
 *     typing "Firstname.Lastname@gmail.com" into the registry would otherwise
 *     create an account nobody can log into.
 *  2. **Gmail aliasing.** `j.doe@gmail.com`, `jdoe@gmail.com` and
 *     `jdoe+work@gmail.com` are the *same Google account*. Google canonicalises
 *     to the dotless, suffix-less form, so any other spelling in the registry
 *     locks the user out with a confusing "not in the system".
 *
 * `normalizeEmail` produces the comparison/index key. The address as typed (or
 * as Google returned it) is what we store and display — normalisation is for
 * matching only, never for presentation.
 *
 * Deliberately *not* applied to non-Google domains: dot-stripping is a Gmail
 * behaviour, and `first.last@company.com` vs `firstlast@company.com` are two
 * different mailboxes everywhere else.
 */

/** Domains where Google treats dots and `+suffix` as insignificant. */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The comparison key for an email address. Lower-cases everything; additionally
 * strips dots and any `+suffix` from the local part on Gmail domains, and folds
 * `googlemail.com` onto `gmail.com`.
 *
 * Returns '' for anything that isn't a syntactically usable address, which
 * callers must treat as "no match" rather than as a wildcard.
 */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';

  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return '';

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (GMAIL_DOMAINS.has(domain)) {
    const plus = local.indexOf('+');
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replace(/\./g, '');
    if (local === '') return '';
    return `${local}@gmail.com`;
  }

  return `${local}@${domain}`;
}

/** Shape-only check. Real validation is Google completing the OAuth flow. */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email.trim());
}

/** The work domain staff are migrating *away* from. */
export const LEGACY_WORK_EMAIL_DOMAIN = '@bluurock.com';

/** True when this address is still a company address, i.e. not yet migrated. */
export function isLegacyWorkEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(LEGACY_WORK_EMAIL_DOMAIN);
}
