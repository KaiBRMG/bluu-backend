/**
 * The onboarding flow, in order. The index of a step in this array is what the
 * progress dots in `OnboardingCard` render — one dot per page, so adding a step
 * here is all that's needed for the rail to pick it up.
 *
 * Forward navigation is driven by each page; re-entry from outside the flow is
 * driven by the guard in `AuthWrapper` (see documentation/onboarding.md).
 */
export const ONBOARDING_STEPS = [
  { path: '/onboarding/welcome', label: 'Terms of use' },
  { path: '/onboarding/permissions', label: 'Permissions' },
  { path: '/onboarding/permission/screen', label: 'Screen capture' },
  { path: '/onboarding/permission/notifications', label: 'Notifications' },
  { path: '/onboarding/profile', label: 'Your details' },
  { path: '/onboarding/done', label: 'All set' },
] as const;

export type OnboardingStepIndex = 0 | 1 | 2 | 3 | 4 | 5;
