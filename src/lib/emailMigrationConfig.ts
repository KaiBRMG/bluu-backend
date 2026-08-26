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

import { normalizeEmail } from '@/lib/authEmail';

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
  // DISARMED 2026-08-26 — the CA cohort is done and nobody is being prompted.
  // The cohort below is left in place deliberately: the machinery still works
  // and re-arming a future cohort is a one-line commit (`enabled: true`).
  // The forward gate is self-clearing, so re-arming can never re-prompt a
  // user who has already migrated.
  enabled: false,
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
  // DISARMED 2026-08-26 — this reversal has landed. Kept listed so the record
  // of who was reverted survives; flip `enabled` back to true to re-arm.
  enabled: false,
  uids: [
    // Mistakenly assigned to the CA group, so swept up by the CA cohort above.
    'qKiuhTreQDU6GAw8h5UuIr50eNp1',
  ],
};

/**
 * ── The correction cohort (redo) ───────────────────────────────────────────
 *
 * The third direction: a user who completed the migration but signed in with the
 * **wrong personal account** (a second Gmail, a typo'd chooser click), and needs
 * to move from that address onto the right one. Personal → personal.
 *
 * ▸ **Why it cannot reuse the forward gate.** `shouldPromptEmailMigration` is
 *   self-clearing because it tests for the company domain, and this user no
 *   longer holds one. Re-arming them there would match nothing. The correction
 *   gate therefore pins the *exact address to be replaced* per uid, and that
 *   pinned address is what makes it self-clearing: the moment `workEmail` is
 *   anything else, the card is gone and cannot come back.
 *
 * ▸ **uid + wrong address, deliberately.** No groups, no `allUsers`, and no
 *   "prompt whoever asks". Listing the address the user is currently stuck on is
 *   what turns this into a genuinely once-off flow rather than a standing licence
 *   for that uid to re-point their login at will — the server re-checks it, so a
 *   corrected user's second attempt is a 403, not a second change.
 *
 * ▸ **We do not name the intended address.** Ownership is proven by OAuth, same
 *   as the other two directions; pinning the destination as well would mean a
 *   typo in this file locks the user out of finishing. The only rule enforced on
 *   the destination is that it is not a company address (that is a migration, not
 *   a correction) and not the address they already hold.
 *
 * ▸ **Mutually exclusive with the other two gates**, same as reversal: a uid
 *   listed for reversal is never offered a correction, and a correction user
 *   holds no company address so cannot match the forward gate.
 */
export interface EmailCorrectionEntry {
  /** The user being corrected. */
  uid: string;
  /**
   * The address they migrated onto **by mistake**. The prompt shows only while
   * `workEmail` still matches this (normalised), and the server refuses the
   * request once it does not — that pairing is the once-off guarantee.
   */
  wrongEmail: string;
}

export interface EmailCorrectionConfig {
  /** Master switch for corrections only. `false` → nobody is corrected. */
  enabled: boolean;
  /** The individual users moving from one personal address to another. */
  users: EmailCorrectionEntry[];
}

export const EMAIL_MIGRATION_CORRECTION: EmailCorrectionConfig = {
  // DISARMED 2026-08-26 — this correction has landed. The entry is kept as the
  // record of what was corrected; it is doubly inert (the pinned wrong address
  // no longer matches the user's `workEmail`). Flip `enabled` back to true and
  // add an entry to run another correction.
  enabled: false,
  users: [
    // Completed the migration signed into the wrong personal Google account.
    { uid: 'CsyRaKMXhiOAQCEVsOENBcxfDud2', wrongEmail: 'jenellemonterde14@gmail.com' },
  ],
};

/**
 * Cohort membership **and** the still-to-do test in one, because for corrections
 * the two are inseparable: the entry is only meaningful while the user still
 * holds the address it names. This is what the API route checks before honouring
 * a `mode: 'correct'` call — it is handed the *server's* copy of `workEmail`, not
 * the client's claim.
 *
 * Returns the entry (truthy) or `null`.
 */
export function getEmailCorrectionEntry(
  uid: string | null | undefined,
  workEmail: string | null | undefined,
): EmailCorrectionEntry | null {
  if (!EMAIL_MIGRATION_CORRECTION.enabled) return null;
  if (!uid || !workEmail) return null;
  if (isEmailReversalCohort(uid)) return null;

  const entry = EMAIL_MIGRATION_CORRECTION.users.find((u) => u.uid === uid);
  if (!entry) return null;

  // An unfilled entry is disarmed, never a wildcard. (`normalizeEmail('')` is
  // '' and would not match a real address anyway — this is the explicit form,
  // so the intent does not rest on that coincidence.)
  const wrongKey = normalizeEmail(entry.wrongEmail);
  if (!wrongKey) return null;

  // Still on the wrong address? Compare on the normalised key — the mistaken
  // address is typed by hand here, and `j.doe@gmail.com` must match `jdoe@…`.
  return normalizeEmail(workEmail) === wrongKey ? entry : null;
}

/**
 * Whether this user should see the *correction* card — "sign in with the right
 * personal account". Same self-clearing shape as the other two gates.
 */
export function shouldPromptEmailCorrection(user: {
  uid?: string;
  workEmail?: string;
} | null | undefined): boolean {
  return !!getEmailCorrectionEntry(user?.uid, user?.workEmail);
}

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
