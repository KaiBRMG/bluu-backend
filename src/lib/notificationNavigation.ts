'use client';

import { watchNavigation } from '@/components/NavigationWatchdog';
import { classifyNotificationAction } from '@/lib/notificationActionUrl';

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
 *  1. **External URLs leave the app.** An action URL naming a host is somewhere
 *     else entirely (a provider dashboard, a shared doc); pushing it into the
 *     App Router would 404. It opens in the system browser instead.
 *     `classifyNotificationAction` decides which is which — and it recognises a
 *     scheme-less host (`www.example.com`), because that is how people type a
 *     URL and a naive `startsWith('http')` check sent exactly those into the
 *     Electron window as if they were app routes.
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
  const target = classifyNotificationAction(actionUrl);

  if (target.kind === 'none') return;

  if (target.kind === 'external') {
    // Electron's `setWindowOpenHandler` turns this into `shell.openExternal`
    // and denies the popup, so the link lands in the user's default browser and
    // the app window never navigates. In a plain browser it is a new tab.
    window.open(target.href, '_blank', 'noopener,noreferrer');
    return;
  }

  watchNavigation(target.href, 'notification-action');
  router.push(target.href);
}
