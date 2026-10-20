'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { isUpdateInFlight } from '@/lib/updateInFlight';
import LoadingScreen from '@/components/LoadingScreen';

/**
 * Reloads the page when this renderer has gone stale — a newer deployment, or a
 * session that sat put away or asleep long enough that its in-memory state can
 * no longer be trusted — but only at a moment where a reload costs the user
 * nothing, and preferably while nobody is looking at the window.
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
 * On macOS it is worse: the X button only HIDES the main window, so a user who
 * "closes" the app at night reopens the very same page days later — weeks-old
 * code against a current backend, a router cache full of entries for a
 * deployment that no longer exists (navigation that does nothing), and
 * fetched-once data that never refreshed.
 *
 * Next's own build-id mismatch hard-navigation only fires on a navigation that
 * reaches the network, so it never rescues the user parked on one page.
 *
 * ── What counts as stale ────────────────────────────────────────────────────
 *  1. **Deployment** — `GET /api/deployment` returns a different id from the
 *     one this bundle first saw. Latched until the reload lands.
 *  2. **Resume** — the session was suspended or put away:
 *      - a wall-clock gap in the 30s tick (the machine slept), or
 *      - the window has been unfocused for `AWAY_STALE_MS` *after the user had
 *        actually used it*. That second clause is the loop guard: a page that
 *        was itself reloaded in the background has never been focused, so it
 *        cannot qualify again until someone returns to it and leaves.
 *
 * ── Why focus/blur, not `visibilitychange` ──────────────────────────────────
 * With `backgroundThrottling: false` — set on every window here — Electron
 * keeps `document.visibilityState` at `visible` even while the window is
 * hidden, minimised or occluded, so `visibilitychange` effectively never fires.
 * Blur is the reliable "the window was put away" signal (hiding a focused
 * window blurs it). The native `power:event` channel would be a more precise
 * wake signal, but `TimeTrackingContext` calls `power.removeEventListener()`
 * (= `removeAllListeners`) in its effect cleanup, so a second listener there is
 * torn out at the first dependency change — hence the tick gap instead.
 *
 * ── When it reloads ─────────────────────────────────────────────────────────
 * Staleness latches; it never forces an immediate reload. Every trigger
 * re-tests the safety gate, so the reload lands at the next safe moment:
 *
 *  - **Only while `clocked-out`** — an allowlist of one state, not "not
 *    working". `idle`, `paused` and `on-break` all mean the session is still
 *    open. Never mid-shift: a reload remounts `TimeTrackingProvider` and tears
 *    down the timer widget. The clock-out transition is itself a trigger.
 *  - **Never over a desktop update** that is downloading or installing —
 *    see `updateInFlight.ts`.
 *  - **Never over unsaved typing**, never during onboarding, never offline
 *    (an offline reload lands on the shell's offline screen instead of the page
 *    the user was on).
 *  - **Resume reloads are rate-limited across reloads** (`sessionStorage`), so
 *    no combination of timer behaviour can turn this into a poll — a reload is
 *    a burst of origin requests (rule 9i).
 *
 * Preferred moment: **while the window is unfocused**, so reopening the app
 * shows a fresh page at once. If the user returns first, the boot loader is
 * painted *before* the reload is issued, so they never interact with — or watch
 * the teardown of — the dead page; the new page's own boot loader takes over
 * seamlessly. When a resume cannot reload (mid-shift), the return instead runs
 * `router.refresh()`, which drops the client router cache (stale prefetches are
 * what make sidebar clicks do nothing) and re-renders server components in
 * place without touching client state.
 *
 * Only the main window mounts this (it lives in `(main)/layout.tsx`); the
 * OF Manager satellite has its own layout and must never reload underneath an
 * operator mid-conversation.
 */

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // deployment backstop for a window that never blurs
const MIN_CHECK_GAP_MS = 60 * 1000;       // focus/blur can fire in bursts
const TICK_MS = 30 * 1000;                // sleep detector + away timer
const SLEEP_GAP_MS = 5 * 60 * 1000;       // a tick this late means the process was suspended
const AWAY_STALE_MS = 30 * 60 * 1000;     // unfocused this long after real use = stale
const MIN_RESUME_RELOAD_GAP_MS = 30 * 60 * 1000;
const RELOAD_STAMP_KEY = 'bluu:resume-reload-at';
// If the reload has not torn this page down by now, something cancelled it —
// lift the cover rather than leave the user staring at a loader.
const COVER_FAILSAFE_MS = 15 * 1000;

type StaleReason = 'deployment' | 'resume';

/** Would a reload throw away something the user typed? An empty focused field
 *  loses nothing — blocking on it would let an autofocused search box pin a
 *  stale page forever. */
function hasUnsavedTyping(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return !!el.textContent?.trim();
  if (el instanceof HTMLTextAreaElement) return el.value.trim() !== '';
  if (el instanceof HTMLInputElement) {
    if (['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type)) {
      return false;
    }
    return el.value.trim() !== '';
  }
  return false;
}

function readReloadStamp(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_STAMP_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeReloadStamp(at: number) {
  try {
    sessionStorage.setItem(RELOAD_STAMP_KEY, String(at));
  } catch {
    // Storage unavailable — the "used since load" guard still prevents a loop.
  }
}

export default function DeploymentRefresher() {
  const { displayState } = useTimeTrackingContext();
  const pathname = usePathname();
  const router = useRouter();
  const [covering, setCovering] = useState(false);

  // The id this bundle was served by — learned on the first check rather than
  // inlined at build time, so there is no NEXT_PUBLIC_ plumbing and the
  // comparison means exactly the right thing: "the deployment changed since
  // this page loaded".
  const bootIdRef = useRef<string | null>(null);
  const staleRef = useRef<StaleReason | null>(null);
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);
  const reloadingRef = useRef(false);

  // Session-staleness bookkeeping. `usedRef` = focused at least once since this
  // page loaded; `awaySinceRef` = when the current unfocused stretch began.
  const usedRef = useRef(false);
  const awaySinceRef = useRef<number | null>(null);
  const lastTickRef = useRef(0); // stamped on mount

  // Read live inside handlers that are registered once.
  const displayStateRef = useRef(displayState);
  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  const canReload = useCallback((reason: StaleReason): boolean => {
    // `clocked-out` is the ONLY safe state, and this is an allowlist of one on
    // purpose. `idle`, `paused` and `on-break` all mean the session is still
    // open — do not "fix" this into `!== 'working'`.
    if (displayStateRef.current !== 'clocked-out') return false;
    if (isUpdateInFlight()) return false;
    if (pathnameRef.current?.startsWith('/onboarding')) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    if (hasUnsavedTyping()) return false;
    if (reason === 'resume' && Date.now() - readReloadStamp() < MIN_RESUME_RELOAD_GAP_MS) {
      return false;
    }
    return true;
  }, []);

  const reloadIfSafe = useCallback(() => {
    const reason = staleRef.current;
    if (!reason || reloadingRef.current) return;
    if (!canReload(reason)) return;

    reloadingRef.current = true;
    if (reason === 'resume') writeReloadStamp(Date.now());

    // Paint the cover first, then reload — two frames so the loader is actually
    // on screen before the navigation starts. The incoming page boots behind
    // the same black loader, so the hand-off is seamless. A hidden window may
    // never get a frame, so a short timer issues the reload regardless.
    setCovering(true);
    let issued = false;
    const issue = () => {
      if (issued) return;
      issued = true;
      window.location.reload();
    };
    requestAnimationFrame(() => requestAnimationFrame(issue));
    window.setTimeout(issue, 150);
    window.setTimeout(() => {
      reloadingRef.current = false;
      setCovering(false);
    }, COVER_FAILSAFE_MS);
  }, [canReload]);

  const markResumeStale = useCallback(() => {
    // Deployment staleness outranks resume: it is not rate-limited.
    if (!staleRef.current) staleRef.current = 'resume';
  }, []);

  const checkDeployment = useCallback(async () => {
    if (reloadingRef.current || checkingRef.current) return;
    if (staleRef.current === 'deployment') return;

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

      staleRef.current = 'deployment';
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
    reloadIfSafe();
    void checkDeployment();
  }, [displayState, reloadIfSafe, checkDeployment]);

  useEffect(() => {
    const focused = document.hasFocus();
    usedRef.current = focused;
    awaySinceRef.current = focused ? null : Date.now();
    lastTickRef.current = Date.now();

    const onFocus = () => {
      usedRef.current = true;
      const awaySince = awaySinceRef.current;
      awaySinceRef.current = null;
      if (awaySince !== null && Date.now() - awaySince >= AWAY_STALE_MS) markResumeStale();

      if (staleRef.current) {
        reloadIfSafe();
        // A resume that cannot reload (mid-shift, typing, rate-limited) is
        // consumed here with a soft refresh instead: the user is back and
        // using the page, so latching it until clock-out would only produce a
        // pointless reload later. Deployment staleness stays latched.
        if (!reloadingRef.current && staleRef.current === 'resume') {
          staleRef.current = null;
          router.refresh();
        }
      }
      void checkDeployment();
    };

    // Blur is the *best* moment to reload — nobody is looking at the window and
    // nothing is being typed into it. On macOS it is also what the X button
    // produces, since hiding the window blurs it.
    const onBlur = () => {
      if (awaySinceRef.current === null) awaySinceRef.current = Date.now();
      reloadIfSafe();
      void checkDeployment();
    };

    // Kept for plain-browser contexts; under Electron it does not fire (above).
    const onVisibility = () => { void checkDeployment(); };

    const onOnline = () => { reloadIfSafe(); };

    const tick = () => {
      const now = Date.now();
      const gap = now - lastTickRef.current;
      lastTickRef.current = now;

      if (gap >= SLEEP_GAP_MS) markResumeStale();

      const awaySince = awaySinceRef.current;
      if (awaySince !== null && usedRef.current && now - awaySince >= AWAY_STALE_MS) {
        markResumeStale();
      }

      // Only reload from the tick while the window is put away — in front of
      // the user, the focus return (or clock-out) is the moment to do it.
      if (awaySince !== null && staleRef.current) reloadIfSafe();
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    const ticker = setInterval(tick, TICK_MS);
    const backstop = setInterval(() => { void checkDeployment(); }, CHECK_INTERVAL_MS);

    void checkDeployment(); // learn this bundle's deployment id

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(ticker);
      clearInterval(backstop);
    };
  }, [checkDeployment, reloadIfSafe, markResumeStale, router]);

  // The one sanctioned render of LoadingScreen outside BootLoaderProvider: it
  // bridges this page's teardown to the next page's boot loader, which is the
  // same black screen — see boot-loading-screen.md.
  return covering ? <LoadingScreen /> : null;
}
