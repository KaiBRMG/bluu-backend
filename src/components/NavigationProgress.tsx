'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { RotateCw, WifiOff } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  getNavigationState,
  notifyNavigationCommitted,
  retryStuckNavigation,
  subscribeNavigationState,
  type NavigationState,
} from '@/components/NavigationWatchdog';

/**
 * Says out loud that a page is loading.
 *
 * ── Why it is needed ────────────────────────────────────────────────────────
 * An App Router `<Link>` click renders the next page inside `startTransition`,
 * which keeps the *current* page mounted and fully interactive until the new
 * one is ready. On a fast connection that is the whole point — no flash of an
 * empty layout. On a slow one it is indistinguishable from a broken app: the
 * user clicks, absolutely nothing changes, and the natural conclusion is that
 * the click did not register, so they click again. A browser tab at least spins
 * its favicon; an Electron window has no such tell, so the app has to provide
 * one.
 *
 * ── Where the state comes from ──────────────────────────────────────────────
 * `NavigationWatchdog`, not a second navigation tracker. It already knows when
 * a navigation was armed and whether it has committed, and it now knows the
 * far harder thing: whether the route payload is still on the wire (slow) or
 * came back without committing (stuck). One source of truth also means this
 * covers imperative navigations — a notification's `actionUrl` — which a
 * `<Link>`-based indicator such as `useLinkStatus` cannot see at all.
 *
 * ── The escalation, and why each step waits as long as it does ──────────────
 *   - **< 400 ms — nothing.** Most navigations here land in well under 200 ms.
 *     A bar that flashes on every click is noise, and worse, it makes a fast
 *     app *look* slow.
 *   - **400 ms — a hairline bar.** Enough to answer "did my click register?"
 *     and nothing more. It trickles toward 90% and never reaches 100 on its
 *     own: the load finishing is what completes it, so the bar cannot promise
 *     an arrival it does not control.
 *   - **Past the watchdog's deadline with bytes still moving — a line of
 *     text.** "Still loading — slow connection" names the cause, which is the
 *     difference between waiting and giving up. Offline gets its own wording,
 *     because "slow" would be a lie and the fix is different.
 *   - **Both automatic rescues failed — a Reload button.** The watchdog stops
 *     guessing after two attempts (see its `MAX_RESCUE_ATTEMPTS`); this is the
 *     hand-off. Never leave the user with a bar that spins forever and no way
 *     to act.
 *
 * Per DESIGN.md this is chrome, not layout: a hairline bar and one quiet line,
 * no spinner dropped into the middle of the page and no modal. It sits on
 * `--z-banner` alongside the other persistent app banners.
 */

/** Below this, a navigation is "instant" and gets no indicator at all. */
const BAR_AFTER_MS = 400;

/** The bar trickles toward this and stops. Only a real commit finishes it. */
const TRICKLE_CEILING = 90;

/** Time constant of the trickle curve — the lower it is, the faster it fills. */
const TRICKLE_TAU_MS = 2500;

/** Clock granularity while a navigation is outstanding. */
const TICK_MS = 150;

const SERVER_SNAPSHOT: NavigationState = { phase: 'idle', since: 0, to: null };

export default function NavigationProgress() {
  const nav = useSyncExternalStore(
    subscribeNavigationState,
    getNavigationState,
    () => SERVER_SNAPSHOT,
  );
  const pathname = usePathname();

  // The watchdog reads `window.location` on its own poll, deliberately, because
  // React is what it cannot trust when a transition wedges. This is the other
  // half: when React *does* commit, tell it immediately so the bar clears on
  // the same tick instead of up to a poll interval later.
  useEffect(() => {
    notifyNavigationCommitted(pathname);
  }, [pathname]);

  // One clock drives both the grace period and the bar. Everything below is
  // *derived* from it rather than stored — there is no second copy of the
  // progress to fall out of sync with the navigation it describes, and the
  // interval only runs while something is actually outstanding.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (nav.phase === 'idle' || nav.phase === 'failed') return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [nav.phase, nav.since]);

  // `since` is when the navigation was armed, so a phase change partway through
  // (pending → slow) does not restart the grace period. Clamped because `now`
  // is left over from the previous navigation until the first tick lands.
  const elapsed = Math.max(0, now - nav.since);
  const visible = nav.phase === 'failed' || elapsed >= BAR_AFTER_MS;
  const showBar = visible && nav.phase !== 'idle' && nav.phase !== 'failed';

  // Decelerating: quick at the start, where progress is plausible, crawling as
  // it nears the ceiling. An honest shape for a duration nothing here knows.
  const value = TRICKLE_CEILING * (1 - Math.exp(-elapsed / TRICKLE_TAU_MS));

  if (nav.phase === 'idle' || !visible) return null;

  const message =
    nav.phase === 'offline'
      ? 'Waiting for a connection…'
      : nav.phase === 'slow'
        ? 'Still loading — slow connection'
        : nav.phase === 'failed'
          ? "Couldn't load that page."
          : null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[var(--z-banner)] flex flex-col items-center pointer-events-none"
      aria-live="polite"
    >
      {showBar && (
        <Progress
          value={value}
          aria-label="Loading page"
          className="h-0.5 w-full rounded-none bg-transparent [&>[data-slot=progress-indicator]]:bg-[#3b82f6]"
        />
      )}

      {message && (
        <div
          role="status"
          className="mt-2 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-[var(--content-background)] px-3 py-1.5 text-xs text-zinc-400 pointer-events-auto"
        >
          {nav.phase === 'offline' && <WifiOff className="size-3.5 shrink-0" aria-hidden />}
          <span>{message}</span>
          {nav.phase === 'failed' && (
            <Button
              size="xs"
              variant="outline"
              className="ml-1 h-6 text-xs"
              onClick={retryStuckNavigation}
            >
              <RotateCw className="size-3" aria-hidden />
              Reload
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
