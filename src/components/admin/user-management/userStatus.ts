import { STATUS_COLORS, STATUS_DOT, type CRStatus } from '@/lib/campaignTracking';
import type { AdminFullUser } from '@/hooks/useAdminUsers';

/**
 * "Invited" = registered by an admin but **not yet set up**.
 *
 * The span deliberately runs from registration all the way to the end of
 * onboarding, not just to first login. A user who signs in once and abandons
 * the flow has told us nothing about themselves — no phone, no address, no
 * emergency contact — and onboarding is all-or-nothing: `recordSuccessfulLogin`
 * discards an incomplete run and drops them back at the login screen. Treating
 * that person as "Active" would mean the registry showed a complete-looking
 * employee record that is in fact empty, which is exactly the case an admin
 * needs to chase.
 *
 * Two signals, because neither is sufficient alone:
 *  • `!lastLoginAt` — never signed in. Catches the fresh registration.
 *  • `hasCompletedOnboarding === false` — signed in, didn't finish.
 *
 * The `=== false` is load-bearing: it must NOT be a plain falsy test. Users
 * created before the onboarding flow shipped have no such field at all, so it
 * arrives as `undefined` — and a falsy test would relabel every one of those
 * long-standing employees as "Invited".
 */
export function isInvitedUser(user: Pick<AdminFullUser, 'lastLoginAt' | 'hasCompletedOnboarding'>): boolean {
  return !user.lastLoginAt || user.hasCompletedOnboarding === false;
}

/** Where an invited user actually got to, for the registry row. */
export function invitedStageLabel(
  user: Pick<AdminFullUser, 'lastLoginAt' | 'hasCompletedOnboarding'>,
): string {
  return user.lastLoginAt ? 'Signed in — onboarding incomplete' : 'Has never signed in';
}

/* -------------------------------------------------------------------------- */

/**
 * The derived lifecycle vocabulary the registry reads.
 *
 * A user record carries three independent raw fields — `isArchived`,
 * `isActive`, and the two onboarding signals behind `isInvitedUser` — and
 * nobody thinks in those. They think "where is this person?". `userStage`
 * collapses them into one closed, four-value vocabulary, and each stage
 * borrows its hue from the campaign status palette rather than re-typing a
 * hex (DESIGN.md §2, the Semantic-Only Rule). This is the same shape
 * `disputeStatus.ts` uses for the two-stage dispute record.
 */
export type UserStage = 'invited' | 'active' | 'no-access' | 'archived';

/** Each stage maps onto an existing semantic hue; never a fresh hex. */
const STAGE_HUE: Record<UserStage, CRStatus> = {
  invited: 'Awaiting Approval', // orange — waiting on a person
  active: 'Completed',          // green  — signed in and set up
  'no-access': 'Rejected',      // red    — sign-in deliberately revoked
  archived: 'Archived',         // zinc   — out of the system, data retained
};

export const STAGE_LABEL: Record<UserStage, string> = {
  invited: 'Not set up',
  active: 'Active',
  'no-access': 'No access',
  archived: 'Archived',
};

/** The one-line "what this means", used as the pill's accessible title. */
export const STAGE_HINT: Record<UserStage, string> = {
  invited: 'Registered, but has not finished setting up their account.',
  active: 'Signed in and finished onboarding.',
  'no-access': 'Sign-in has been revoked. Their data is untouched.',
  archived: 'Removed from the system. Nothing has been deleted.',
};

/** Ordered as the sections read, top to bottom. */
export const USER_STAGES: UserStage[] = ['invited', 'active', 'no-access', 'archived'];

/**
 * Precedence is deliberate and matches what the old card showed.
 *
 * Archived wins outright — an archived person is out of the system whatever
 * else is true of them. "Not set up" then beats "No access", because a record
 * that was never completed is the more useful fact about it: an account that
 * has never been used tells you nothing by also being switched off.
 */
export function userStage(
  user: Pick<AdminFullUser, 'isArchived' | 'isActive' | 'lastLoginAt' | 'hasCompletedOnboarding'>,
): UserStage {
  if (user.isArchived) return 'archived';
  if (isInvitedUser(user)) return 'invited';
  if (user.isActive === false) return 'no-access';
  return 'active';
}

/** `text-*-400 bg-*-500/10` — the pill recipe from the shared palette. */
export function stagePillClass(stage: UserStage): string {
  return STATUS_COLORS[STAGE_HUE[stage]];
}

/** `bg-*-400` — the compact dot for a dense row. */
export function stageDotClass(stage: UserStage): string {
  return STATUS_DOT[STAGE_HUE[stage]];
}
