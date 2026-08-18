'use client';

import { useEffect, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Rescues a client navigation that starts but never commits.
 *
 * ── The failure it exists for ───────────────────────────────────────────────
 * Clicking a sidebar link does nothing — no URL change, no loading skeleton —
 * while the page you are already on stays completely interactive. The app looks
 * frozen but is not: an App Router `<Link>` click runs inside `startTransition`,
 * and React deliberately keeps the *old* tree mounted and responsive while it
 * renders the new one. If that transition never finishes, you get exactly this
 * shape of failure, and buttons/tabs/dialogs on the current page keep working
 * throughout because their updates are urgent priority and preempt it.
 *
 * The network is NOT the problem — a capture during a live occurrence showed
 * every `?_rsc=` request returning 200/304 in 46–186 ms, with the *same* route
 * payload arriving over and over while nothing rendered. The data lands; the
 * commit never happens.
 *
 * Two things in this app combine to cause it, and both are addressed elsewhere:
 *   1. `staleTimes.dynamic` defaulted to 0, so every interrupted retry re-fetched
 *      and re-suspended on a new promise instead of reusing the payload it had.
 *      Fixed in `next.config.ts`.
 *   2. `TimeTrackingContext` changes its value identity once a second (the
 *      `elapsedSeconds` tick), and `AppLayout` is mounted per-page so every
 *      navigation re-renders the whole sidebar/top-bar shell. A 1 Hz urgent
 *      update racing an expensive transition render is what interrupts it.
 *      Both still outstanding — see CLAUDE.md.
 *
 * ── Why this exists anyway ──────────────────────────────────────────────────────
 * Every one of those fixes is a hypothesis about the root cause. This is not:
 * whatever the reason a transition fails to commit, a hard navigation always
 * works, because it discards the entire client router state. Keep it even if
 * the hang is believed fixed — it is the only thing that rescues a user who is
 * *already* stuck, and the population here (long shifts, an Electron renderer
 * that never reloads on its own) has no other way out but quitting the app.
 *
 * ── Deliberate divergence from `DeploymentRefresher` ────────────────────────────
 * That component refuses to reload outside `clocked-out`, because a reload for a
 * routine code update is not worth churning an open session. This one reloads
 * whenever it fires, mid-shift included. The difference is that the user is in a
 * *failure* state and cannot navigate at all — the session survives a reload
 * (that is what the crash-recovery path in `TimeTrackingContext` is for), and
 * being stuck is strictly worse. Do not "align" this with the clocked-out gate.
 */

/**
 * How long a click may go uncommitted before we force it.
 *
 * Deliberately generous. Healthy RSC fetches here land in well under 200 ms, and
 * a genuinely slow route still commits fast because its `loading.tsx` boundary
 * renders immediately — so a URL that has not changed after this long is stuck,
 * not slow.
 */
const STUCK_AFTER_MS = 4000;

function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export default function NavigationWatchdog() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rescuingRef = useRef(false);

  useEffect(() => {
    const clearPending = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const onClick = (e: MouseEvent) => {
      if (rescuingRef.current || !isPlainLeftClick(e)) return;

      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;

      // New tab / download / anything the router was never going to handle.
      if (anchor.target || anchor.hasAttribute('download')) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // Cross-origin (and `bluu://`, `mailto:` …) leave the app entirely.
      if (url.origin !== window.location.origin) return;

      const from = window.location.pathname;
      const to = url.pathname;

      // Same page, or a hash/query-only change — no route transition to watch.
      if (to === from) return;

      // Onboarding is nothing but a form; a hard navigation would discard
      // whatever the user has typed. Same reasoning as `DeploymentRefresher`.
      if (from.startsWith('/onboarding') || to.startsWith('/onboarding')) return;

      // A second click supersedes the first — watch the latest intent only.
      clearPending();

      timerRef.current = setTimeout(() => {
        timerRef.current = null;

        // `window.location` is the deliberate signal here rather than
        // `usePathname()`: the App Router pushes the history entry as part of
        // the commit, so the URL changing *is* the commit, and reading it does
        // not depend on React having rendered anything. Under the failure this
        // guards against, React is precisely what cannot be trusted to run.
        //
        // Still on the original path means the transition never landed. A
        // different path means it committed, or the user went elsewhere —
        // either way there is nothing to rescue.
        if (window.location.pathname !== from) return;

        rescuingRef.current = true;

        // Telemetry is half the point: this tells us whether the hang is still
        // happening in the fleet after the config and layout fixes, and on which
        // routes. If these stop arriving, the underlying cause is actually gone.
        Sentry.captureMessage('Navigation watchdog forced a hard navigation', {
          level: 'warning',
          tags: { area: 'navigation', reason: 'transition-never-committed' },
          extra: { from, to, stuckAfterMs: STUCK_AFTER_MS },
        });

        window.location.href = url.href;
      }, STUCK_AFTER_MS);
    };

    // Capture phase: `Link` calls `preventDefault()` in its own handler, so by
    // the bubble phase we could not tell "the router took this and stalled" from
    // "nothing handled it". We only observe here — never intercept — so running
    // first costs nothing.
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      clearPending();
    };
  }, []);

  return null;
}
