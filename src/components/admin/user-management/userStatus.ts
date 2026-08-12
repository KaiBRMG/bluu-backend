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

/** Where an invited user actually got to, for the registry card. */
export function invitedStageLabel(
  user: Pick<AdminFullUser, 'lastLoginAt' | 'hasCompletedOnboarding'>,
): string {
  return user.lastLoginAt ? 'Signed in — onboarding incomplete' : 'Has never signed in';
}
