'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { watchNavigation } from '@/components/NavigationWatchdog';

/** Mirrors `DeepLinkRoute` in types/electron.d.ts — declared locally because
 *  that file is an ambient declaration nothing else imports from. */
interface DeepLinkRoute {
  url: string;
  host: string;
  pathname: string;
  params: Record<string, string>;
  at: number;
}

/**
 * Routes non-OAuth `bluu://` deep links.
 *
 * The Electron shell deliberately does not interpret these — `handleDeepLink` in
 * `main.js` parses the URL and hands the parts to the renderer, which owns
 * routing policy. **Adding a deep-link route therefore never needs a native
 * build** (rule 14 does not apply to this file).
 *
 * Two intake paths, and both are required:
 *  • `getPendingDeepLink()` on mount — a link that launched a cold app arrives
 *    before React exists, so main parks it and the renderer collects it.
 *  • `onDeepLink` — a link that arrives while the app is already running.
 *
 * Every navigation here is imperative, so it must arm the watchdog explicitly:
 * `NavigationWatchdog`'s own listener only sees anchor clicks, and an
 * unwatched `router.push` that wedges would be invisible to it. Same rule the
 * notification `actionUrl`s follow — see notifications.md RULE 3.
 *
 * Mounted in `(main)/layout.tsx`, outside `LazyProviders`, so a link can be
 * honoured before the lazily-imported providers have arrived.
 */
export default function DeepLinkRouter() {
  const router = useRouter();

  const handle = useCallback(
    (route: DeepLinkRoute | null) => {
      if (!route) return;

      // `bluu://prompt?id=<promptId>` — a shared prompt, opened from the public
      // page's "Open in Bluu Backend". The library page reads `?prompt=` and
      // opens the detail dialog over whichever surface it lands on, which is
      // what a click from anywhere inside the app already produces.
      if (route.host === 'prompt') {
        const id = route.params.id ?? route.pathname.replace(/^\//, '');
        if (!id) return;
        const to = `/applications/apps-prompt-library?prompt=${encodeURIComponent(id)}`;
        watchNavigation(to);
        router.push(to);
        return;
      }

      // Unknown host: ignored on purpose. A shell that has been installed for
      // weeks can emit a route this bundle has never heard of, and vice versa —
      // silently doing nothing is the correct handling of both.
    },
    [router],
  );

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.app : undefined;
    if (!api?.onDeepLink) return;

    api.onDeepLink(handle);
    // Collect anything that landed before this mounted. Fire-and-forget: the
    // handler is a no-op for null, and a rejected promise here must not break
    // the layout.
    void api.getPendingDeepLink?.().then(handle).catch(() => {});

    return () => api.removeDeepLinkListener?.();
  }, [handle]);

  return null;
}
