'use client';

import { watchNavigation } from '@/components/NavigationWatchdog';

/** The slice of `useRouter()` this needs — kept structural so callers can pass
 *  the App Router instance without this module importing `next/navigation`. */
type PushRouter = { push: (href: string) => void };

/**
 * Follow a notification's `actionUrl`.
 *
 * Every notification surface goes through here — the in-app tray, the home-page
 * widget, and the OS toast's `notification:navigate` IPC — so that all three
 * agree on two things:
 *
 *  1. **Absolute URLs leave the app.** An `http(s)://` action URL is somewhere
 *     else entirely (a provider dashboard, a shared doc); pushing it into the
 *     App Router would 404. It opens in the system browser instead.
 *  2. **Internal ones arm the navigation watchdog.** `router.push()` has no
 *     anchor for `NavigationWatchdog`'s click listener to observe, so without
 *     this call an action URL is the one navigation the watchdog cannot rescue
 *     — and it is the worst one to lose, because clicking the notification is
 *     also what dismisses it. There is no second chance at the link.
 *
 * `watchNavigation` only schedules a check; it never navigates by itself, and
 * it no-ops when there is no transition to watch (same path, onboarding).
 */
export function navigateToNotificationAction(
  router: PushRouter,
  actionUrl: string | null | undefined,
): void {
  if (!actionUrl) return;

  if (actionUrl.startsWith('http://') || actionUrl.startsWith('https://')) {
    window.open(actionUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  watchNavigation(actionUrl, 'notification-action');
  router.push(actionUrl);
}
