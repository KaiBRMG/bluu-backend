/**
 * Gate for the one-time company-email → personal-email migration.
 *
 * **This file is the only thing that decides who is prompted.** Everything else
 * — the dialog, the endpoint, the OAuth round-trip — is already deployed and
 * inert until a cohort is armed here. Modelled on `appUpdateConfig.ts`, and for
 * the same reason: a phased rollout wants a one-line commit, not a code change.
 *
 * ▸ **`enabled: false` means nobody is prompted, full stop.** This is the
 *   default state and the kill switch. Flip it back if a cohort goes wrong.
 *
 * ▸ A user is prompted when `enabled` is true, they still hold an
 *   `@bluurock.com` address, AND (`allUsers` OR their uid is listed OR one of
 *   their groups is listed). The company-address test is what makes this
 *   self-clearing: a migrated user stops matching, so no "already done" flag is
 *   needed and re-arming a cohort can never re-prompt someone twice.
 *
 * ▸ **The card waits for clock-out.** A user mid-shift is never interrupted;
 *   they are prompted at their next app start. Arming a cohort therefore takes
 *   effect over a day or so, not instantly — that is deliberate.
 *
 * ▸ Enforcement is **soft**: a blocking dialog in the renderer, not a server
 *   403. It is a cooperative internal rollout, not an adversarial one. If
 *   stragglers need forcing later, that is a deliberate follow-up.
 *
 * Suggested order: one or two volunteers by uid → a single group → `allUsers`.
 */

export interface EmailMigrationConfig {
  /** Master switch. `false` → nobody is prompted, whatever else is set. */
  enabled: boolean;
  /** Prompt everyone still on a company address. Ignores `uids`/`groups`. */
  allUsers: boolean;
  /** Individual uids to prompt — the volunteer cohort. */
  uids: string[];
  /** Group slugs to prompt (e.g. 'CA', 'SMM', 'OFAM', 'admin'). */
  groups: string[];
}

export const EMAIL_MIGRATION: EmailMigrationConfig = {
  // ── Rollout state ──────────────────────────────────────────────────────
  // Shipped disarmed. Arm a cohort in its own commit, once the code is live.
  enabled: false,
  allUsers: false,
  uids: [],
  groups: [],
};

/**
 * Whether this user should see the migration card.
 *
 * `workEmail` carries the whole "have they migrated yet?" answer, so there is no
 * separate flag to keep in sync — and no way for a stale flag to prompt someone
 * who is already done, or to hide the card from someone who is not.
 */
export function shouldPromptEmailMigration(user: {
  uid?: string;
  workEmail?: string;
  groups?: string[];
} | null | undefined): boolean {
  if (!EMAIL_MIGRATION.enabled) return false;
  if (!user?.workEmail) return false;

  // Already migrated (or never had a company address) — nothing to do.
  if (!user.workEmail.trim().toLowerCase().endsWith('@bluurock.com')) return false;

  if (EMAIL_MIGRATION.allUsers) return true;
  if (user.uid && EMAIL_MIGRATION.uids.includes(user.uid)) return true;
  return (user.groups ?? []).some((g) => EMAIL_MIGRATION.groups.includes(g));
}
