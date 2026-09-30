/**
 * Growth Tracking — who may see it, and how many accounts one person may pin.
 *
 * Pure, so the server's access check, the home page's decision to mount the
 * widget, the pin hook and both routes that validate pins all read the same
 * values — a widget shown to someone the API refuses, or a pin cap the client
 * and server disagree on, is what keeping them in one place prevents.
 */

/** Holding any of these pages grants Growth Tracking — reads and writes alike. */
export const GROWTH_PAGE_IDS = ['smm-growth-tracking', 'smm-admin'] as const;

/** Whether a user's permitted pages include Growth Tracking. */
export function canUseGrowthTracking(permittedPageIds: readonly string[] | undefined): boolean {
  return (permittedPageIds ?? []).some((id) => (GROWTH_PAGE_IDS as readonly string[]).includes(id));
}

/** Accounts one person may pin to the home widget. Enforced in `/api/user/update`. */
export const MAX_PINNED_GROWTH_ACCOUNTS = 5;
