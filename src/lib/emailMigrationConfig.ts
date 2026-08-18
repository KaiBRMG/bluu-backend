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
  enabled: true,
  allUsers: false,
  uids: [],
  groups: ['CA'],
};

/**
 * ── The reversal cohort (undo) ─────────────────────────────────────────────
 *
 * The mirror image of the above: move a uid **back** onto their `@bluurock.com`
 * address. It exists for one reason — a user who was in a cohort by mistake
 * (wrong group membership) and got migrated anyway.
 *
 * ▸ **uid-only, deliberately.** No `groups`, no `allUsers`. A reversal is always
 *   a named individual being corrected; there is no scenario where a bulk undo
 *   is the right tool, and offering one invites a rollout being undone by a
 *   typo.
 *
 * ▸ **Self-clearing, same as the forward gate**: it prompts only while the user
 *   holds a *non*-company address, so the card disappears the moment the
 *   reversal lands.
 *
 * ▸ **Listed uids are excluded from the forward migration** (see
 *   `shouldPromptEmailMigration`). Without that, reverting a CA-group user would
 *   immediately re-match the forward gate and prompt them to migrate again —
 *   an infinite loop between the two cards. Leave the uid listed here for as
 *   long as they would otherwise match a forward cohort.
 *
 * ▸ **This list is also the server-side authority**: `/api/auth/migrate-email`
 *   refuses a `mode: 'revert'` request from a uid that is not listed, so a
 *   client cannot claim a company address by hand-crafting the call.
 */
export interface EmailReversalConfig {
  /** Master switch for reversals only. `false` → nobody is reverted. */
  enabled: boolean;
  /** The individual uids being moved back onto a company address. */
  uids: string[];
}

export const EMAIL_MIGRATION_REVERSAL: EmailReversalConfig = {
  enabled: true,
  uids: [
    // Mistakenly assigned to the CA group, so swept up by the CA cohort above.
    'qKiuhTreQDU6GAw8h5UuIr50eNp1',
  ],
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

  // A uid queued for (or already through) a reversal is never migrated forward
  // again — otherwise the two gates ping-pong: revert → matches CA cohort →
  // migrate → matches reversal cohort → revert. The reversal list wins.
  if (user.uid && isEmailReversalCohort(user.uid)) return false;

  // Already migrated (or never had a company address) — nothing to do.
  if (!user.workEmail.trim().toLowerCase().endsWith('@bluurock.com')) return false;

  if (EMAIL_MIGRATION.allUsers) return true;
  if (user.uid && EMAIL_MIGRATION.uids.includes(user.uid)) return true;
  return (user.groups ?? []).some((g) => EMAIL_MIGRATION.groups.includes(g));
}

/**
 * Cohort membership only — no address test. This is what the API route checks
 * before honouring a `mode: 'revert'` call, and what the forward gate consults
 * to exclude a reverted user. Keep it separate from
 * `shouldPromptEmailReversal`, which additionally asks "is there anything left
 * to do?" and therefore goes false the instant the reversal commits.
 */
export function isEmailReversalCohort(uid: string | null | undefined): boolean {
  if (!EMAIL_MIGRATION_REVERSAL.enabled) return false;
  return !!uid && EMAIL_MIGRATION_REVERSAL.uids.includes(uid);
}

/**
 * Whether this user should see the *reversal* card — "sign back in with your
 * @bluurock.com account".
 *
 * Mirror of `shouldPromptEmailMigration`, with the address test inverted: they
 * are prompted while they hold a non-company address, and stop matching as soon
 * as the company address is back on the doc. Same self-clearing property, same
 * "no flag to keep in sync".
 */
export function shouldPromptEmailReversal(user: {
  uid?: string;
  workEmail?: string;
} | null | undefined): boolean {
  if (!user?.workEmail) return false;
  if (!isEmailReversalCohort(user.uid)) return false;

  // Already back on a company address — done.
  return !user.workEmail.trim().toLowerCase().endsWith('@bluurock.com');
}
