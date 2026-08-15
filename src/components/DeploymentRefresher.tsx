'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { isUpdateInFlight } from '@/lib/updateInFlight';

/**
 * Reloads the page when the deployment serving production is newer than the
 * bundle this renderer is running — but only at a moment where a reload costs
 * the user nothing.
 *
 * ── Why this is needed at all ───────────────────────────────────────────────
 * The Electron shell **never reloads the renderer on its own.** `main.js`
 * reloads on exactly three events — a renderer crash, `did-fail-load`, and the
 * offline screen's retry button — all failures. Sleep/wake is not one: the
 * window keeps its process (`backgroundThrottling: false` keeps its timers
 * alive), Firestore listeners reconnect silently, and `TimeTrackingContext`
 * patches the sleep gap into the session log. Every one of those paths is built
 * to *survive* without a page load, which is precisely why none causes one.
 *
 * The only other refresh path is Next's build-id mismatch: the App Router
 * hard-navigates when an RSC response's build id differs from the client's. That
 * fires only on a navigation that actually reaches the network, so a user who
 * moves around the app picks up a deploy within minutes — and a user parked on
 * one page (clock out, leave the app open, sleep, wake, repeat) picks it up
 * never. That user runs weeks-old client code against a current backend.
 *
 * ── When it reloads ─────────────────────────────────────────────────────────
 * Checks are cheap (`GET /api/deployment`, rate-limited to one per minute) and
 * fire on the moments correlated with staleness: window focus and blur, tab
 * visibility, a clock-out transition, and a 30-minute backstop. Focus/blur are
 * DOM events on purpose — the native `power:event` channel would have been the
 * more precise wake signal, but `TimeTrackingContext` calls
 * `power.removeEventListener()` (which is `removeAllListeners`) in its effect
 * cleanup, so a second listener there would be torn out at the first dependency
 * change. Regaining focus after a wake covers the same ground with no shared
 * state.
 *
 * Detecting staleness never forces an immediate reload. `staleRef` latches, and
 * every later trigger re-tests the safety gate, so the reload lands at the next
 * safe moment instead of being lost:
 *
 *  - **Only while `clocked-out`** — an allowlist of one state, not "not
 *    working". `idle`, `paused` and `on-break` all mean the session is still
 *    open, and a break is if anything *more* likely to be the moment the user
 *    walks away mid-something. Not deferred to "a quiet moment mid-shift"
 *    either — never. A reload remounts `TimeTrackingProvider` and tears down
 *    the timer widget; the session survives it (that is what the crash-recovery
 *    path is for), but an open session is not something to churn for a code
 *    update. The clock-out transition is itself a trigger, so the wait ends
 *    there.
 *  - **Never over a desktop update** that is downloading or installing —
 *    see `updateInFlight.ts`.
 *  - **Never while the user is typing**, and never during onboarding. A forced
 *    reload discards unsubmitted form state, and onboarding is the one flow
 *    that is nothing but a form.
 *
 * Only the main window mounts this (it lives in `(main)/layout.tsx`); the
 * OF Manager satellite has its own layout and must never reload underneath an
 * operator mid-conversation.
 */

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // backstop for a window that never blurs
const MIN_CHECK_GAP_MS = 60 * 1000;       // focus/blur can fire in bursts

/** Would a reload throw away something the user typed? */
function isEditing(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export default function DeploymentRefresher() {
  const { displayState } = useTimeTrackingContext();
  const pathname = usePathname();

  // The id this bundle was served by — learned on the first check rather than
  // inlined at build time, so there is no NEXT_PUBLIC_ plumbing and the
  // comparison means exactly the right thing: "the deployment changed since
  // this page loaded".
  const bootIdRef = useRef<string | null>(null);
  const staleRef = useRef(false);
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);
  const reloadingRef = useRef(false);

  // Read live inside handlers that are registered once.
  const displayStateRef = useRef(displayState);
  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  const reloadIfSafe = useCallback(() => {
    if (!staleRef.current || reloadingRef.current) return;
    // `clocked-out` is the ONLY safe state, and this is an allowlist of one on
    // purpose. `idle`, `paused` and `on-break` all mean the session is still
    // open — do not "fix" this into `!== 'working'`.
    if (displayStateRef.current !== 'clocked-out') return;
    if (isUpdateInFlight()) return;
    if (pathnameRef.current?.startsWith('/onboarding')) return;
    if (isEditing()) return;

    reloadingRef.current = true;
    window.location.reload();
  }, []);

  const check = useCallback(async () => {
    if (reloadingRef.current || checkingRef.current) return;

    // Already known stale — no point asking again, just retry the gate.
    if (staleRef.current) {
      reloadIfSafe();
      return;
    }

    const now = Date.now();
    if (now - lastCheckRef.current < MIN_CHECK_GAP_MS) return;
    lastCheckRef.current = now;

    checkingRef.current = true;
    try {
      const res = await fetch('/api/deployment', { cache: 'no-store' });
      if (!res.ok) return;
      const data: unknown = await res.json();
      const id =
        data && typeof data === 'object' && typeof (data as { id?: unknown }).id === 'string'
          ? (data as { id: string }).id
          : null;

      // Null means the host couldn't tell us (local dev). Treated as "don't
      // know", never as "changed" — otherwise every client reload-loops.
      if (!id) return;
      if (bootIdRef.current === null) {
        bootIdRef.current = id;
        return;
      }
      if (id === bootIdRef.current) return;

      staleRef.current = true;
      reloadIfSafe();
    } catch {
      // Offline or mid-deploy. The next trigger tries again.
    } finally {
      checkingRef.current = false;
    }
  }, [reloadIfSafe]);

  // Clock-out is both a trigger and the moment a deferred reload is released.
  useEffect(() => {
    if (displayState !== 'clocked-out') return;
    void check();
  }, [displayState, check]);

  useEffect(() => {
    const onVisibility = () => { void check(); };
    const onFocus = () => { void check(); };
    // Blur is the *best* moment to reload — nobody is looking at the window and
    // nothing is being typed into it.
    const onBlur = () => { void check(); };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    const interval = setInterval(() => { void check(); }, CHECK_INTERVAL_MS);

    void check(); // learn this bundle's deployment id

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      clearInterval(interval);
    };
  }, [check]);

  return null;
}
