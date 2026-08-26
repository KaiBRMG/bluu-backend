'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Rescues a client navigation that starts but never commits — and, just as
 * importantly, *declines* to rescue one that is merely slow.
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
 * A capture during a live occurrence showed every `?_rsc=` request returning
 * 200/304 in 46–186 ms, with the *same* route payload arriving over and over
 * while nothing rendered. In that instance the data landed and the commit never
 * happened — which is the hang. It is **not** the only way a navigation fails to
 * arrive, and this file no longer assumes it is; see the next section.
 *
 * ── Stuck vs slow: the distinction this whole file turns on ─────────────────
 * A flat "the URL has not changed in 4s, force a reload" is wrong on a bad
 * connection. There, the URL has not changed because the payload has not
 * arrived yet — and converting that into a hard navigation throws away the
 * in-flight fetch and starts the whole document again, which is *slower* than
 * waiting. The user sees the app reload itself for no reason, and is no closer
 * to the page they asked for.
 *
 * So reaching the deadline is not the decision. `classifyStall()` is:
 *
 *   - **An RSC request is in flight** → the network is working, we are just
 *     waiting. Extend the deadline (up to `MAX_EXTENSIONS`) and let
 *     `NavigationProgress` say so. Do not rescue.
 *   - **An RSC request came back and we still have not committed** → the hang:
 *     the payload landed, the commit did not. Rescue now.
 *   - **An RSC request *failed*** (404/403/network error) → almost always a
 *     stale client whose pinned deployment is gone. Retrying the same route
 *     cannot fix that; only a fresh document can. Rescue immediately, and
 *     reload rather than route.
 *   - **Offline** → hold. A hard navigation offline lands on Electron's offline
 *     page and loses the user's place for nothing. Re-check on `online`.
 *   - **Nothing happened at all** → either the router never received the click,
 *     or the payload came from the router cache and still did not commit. Both
 *     are stuck. Rescue.
 *
 * ── Why the rescue is not a one-shot ────────────────────────────────────────
 * This used to set `rescuing = true` and never clear it. If the forced
 * navigation then failed to happen — exactly what a stale client hits once a
 * new deployment has landed and its pinned assets are gone — the watchdog was
 * permanently disarmed for the life of the renderer, and every later click was
 * silently ignored. That is the "it worked before, it did nothing this time"
 * failure. A rescue is now *verified*: if we are still on the same path
 * `RESCUE_VERIFY_MS` after forcing one, the rescue itself failed, and we
 * escalate rather than give up.
 *
 * The ladder, per stuck navigation:
 *   1. `location.assign(href)` — hard-navigate to the intended route.
 *   2. `location.reload()` — the target route may be the thing that cannot
 *      load; take a fresh document of *this* page instead.
 *   3. Stop, and hand the user a visible "Couldn't load — Reload" affordance
 *      through `NavigationProgress`. Two failed automatic attempts means a
 *      third guess will not help, and would risk a reload loop.
 *
 * No autonomous loop is possible at any rung: arming requires a click or a
 * notification action, so the watchdog only ever acts on an intent the user
 * actually expressed.
 *
 * ── Three ways it is checked, because a timer alone is not trustworthy ──────
 * Under the failure this guards against, the main thread is the thing that
 * cannot be relied on — a wedged render loop starves `setTimeout` callbacks
 * indefinitely. (Background throttling is *not* a factor: the shell sets
 * `backgroundThrottling: false` on every window.) So the deadline is also
 * evaluated:
 *   - **on every subsequent qualifying click** — a real user gesture, and the
 *     natural thing a stuck user does. Repeated clicking is now the escape
 *     hatch rather than a no-op.
 *   - **on `visibilitychange` / `focus`** — for a window that was minimised
 *     while a navigation was pending.
 *   - **on `online`** — releases a navigation held back by being offline.
 *
 * ── Two ways in ────────────────────────────────────────────────────────────
 * The `click` listener covers `<Link>`/anchor navigations. Anything navigating
 * *imperatively* — `router.push()`, with no anchor to observe — must arm the
 * watchdog itself via `watchNavigation()`. Notification action URLs are the
 * whole of that category today (the in-app tray, the home widget, and the OS
 * toast's `notification:navigate` IPC), and they are the navigations you least
 * want to lose: clicking the notification is also what dismisses it, so a
 * transition that never commits leaves the user with no second chance at the
 * link. Route them through `navigateToNotificationAction()` in
 * `src/lib/notificationNavigation.ts` rather than calling `router.push`.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────
 * Every named cause above is a hypothesis. This is not: whatever the reason a
 * transition fails to commit, a hard navigation always works, because it
 * discards the entire client router state. Keep it even if the hang is believed
 * fixed — it is the only thing that rescues a user who is *already* stuck, and
 * the population here (long shifts, an Electron renderer that never reloads on
 * its own) has no other way out but quitting the app.
 *
 * ── Deliberate divergence from `DeploymentRefresher` ────────────────────────
 * That component refuses to reload outside `clocked-out`, because a reload for a
 * routine code update is not worth churning an open session. This one reloads
 * whenever it fires, mid-shift included. The difference is that the user is in a
 * *failure* state and cannot navigate at all — the session survives a reload
 * (that is what the crash-recovery path in `TimeTrackingContext` is for), and
 * being stuck is strictly worse. Do not "align" this with the clocked-out gate.
 *
 * It also covers the one combination `DeploymentRefresher` deliberately will
 * not: **clocked in when a new deployment lands.** That client is left stale on
 * purpose, so when its pinned assets stop resolving this is the only thing
 * standing between the user and a dead sidebar.
 */

/**
 * How long a navigation may go uncommitted before we *classify* it.
 *
 * Not "before we reload" — reaching this only opens the stuck-vs-slow question.
 * Healthy RSC fetches here land in well under 200 ms, and a genuinely slow
 * route still commits fast because its `loading.tsx` boundary renders
 * immediately.
 */
const STUCK_AFTER_MS = 4000;

/** How much longer a demonstrably-still-loading navigation gets per round. */
const SLOW_EXTENSION_MS = 4000;

/**
 * How many extensions a slow navigation gets before it is rescued anyway
 * (4s + 6 × 4s ≈ 28s). A connection that cannot deliver a route payload in half
 * a minute will not deliver it on the next tick either, and a fresh document at
 * least has a chance of hitting a warm edge cache.
 */
const MAX_EXTENSIONS = 6;

/** A forced navigation that has not taken effect by now did not take effect. */
const RESCUE_VERIFY_MS = 8000;

/** How often a pending navigation is re-evaluated while one is outstanding. */
const POLL_MS = 250;

/** Automatic attempts before the user is asked to act. */
const MAX_RESCUE_ATTEMPTS = 2;

// ─── Public state, consumed by NavigationProgress ────────────────────────────

export type NavigationSource = 'link' | 'notification-action';

export type NavigationPhase =
  /** Nothing outstanding. */
  | 'idle'
  /** A navigation is in flight and behaving normally. */
  | 'pending'
  /** Still fetching past the deadline — a slow connection, not a hang. */
  | 'slow'
  /** Pending while the browser reports no connection. */
  | 'offline'
  /** Both automatic rescues failed; only the user can move this forward. */
  | 'failed';

export type NavigationState = {
  phase: NavigationPhase;
  /** When this navigation was armed (`Date.now()`). */
  since: number;
  /** Target pathname, for a "still loading…" affordance. */
  to: string | null;
};

const IDLE: NavigationState = { phase: 'idle', since: 0, to: null };

let state: NavigationState = IDLE;
const listeners = new Set<(s: NavigationState) => void>();

function setState(next: NavigationState) {
  if (next.phase === state.phase && next.to === state.to && next.since === state.since) return;
  state = next;
  listeners.forEach((fn) => fn(state));
}

export function getNavigationState(): NavigationState {
  return state;
}

/** Subscribe to navigation state. Returns an unsubscribe function. */
export function subscribeNavigationState(fn: (s: NavigationState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The `failed` phase's escape hatch, wired to the retry button. */
export function retryStuckNavigation() {
  const href = pending?.href;
  settle();
  if (href) window.location.assign(href);
  else window.location.reload();
}

// ─── RSC request instrumentation ─────────────────────────────────────────────

/**
 * The stuck-vs-slow call needs to know whether the route payload is still on
 * the wire. `PerformanceObserver` only reports requests that have *finished*,
 * which is precisely the state we need to tell apart from "still going", so the
 * App Router's own `fetch` is wrapped instead.
 *
 * Only same-document RSC requests are counted (`_rsc=` on the URL, or the `RSC`
 * request header). Firestore streams, image loads and API calls say nothing
 * about a route transition and must not extend its deadline.
 *
 * **It degrades safely.** If a future Next version resolves `fetch` at module
 * load (before this patch lands) or stops marking these requests recognisably,
 * `rscInFlight` simply stays 0 and `lastRscFailedAt` never moves — every stall
 * then classifies as `stuck` and the watchdog behaves exactly as it did before
 * this instrumentation existed. A silent regression here costs the slow-network
 * courtesy, never the rescue. If you are checking whether it still works, the
 * `rscInFlight` value on a Sentry rescue event is the tell.
 *
 * One imprecision, accepted: link *prefetches* are RSC requests too, so one in
 * flight during a genuine hang can buy that hang an extra `SLOW_EXTENSION_MS`.
 * Prefetches are short-lived and the cost is one extra round, so this is not
 * worth distinguishing.
 */
let rscInFlight = 0;
let lastRscFailedAt = 0;

const FETCH_PATCH_FLAG = '__bluuNavWatchdogPatched';

function isRscRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  let url = '';
  if (typeof input === 'string') url = input;
  else if (input instanceof URL) url = input.href;
  else if (input && typeof input === 'object' && 'url' in input) url = (input as Request).url;
  if (url.includes('_rsc=')) return true;

  // Belt and braces: the router also marks these with an `RSC` header, and the
  // query parameter is an implementation detail that has changed before.
  const headers = init?.headers ?? (typeof input === 'object' && input !== null && 'headers' in input
    ? (input as Request).headers
    : undefined);
  if (!headers) return false;
  if (headers instanceof Headers) return headers.has('RSC');
  if (Array.isArray(headers)) return headers.some(([k]) => k.toLowerCase() === 'rsc');
  return Object.keys(headers).some((k) => k.toLowerCase() === 'rsc');
}

function instrumentFetch() {
  if (typeof window === 'undefined') return;
  const original = window.fetch;
  if (!original || (original as unknown as Record<string, unknown>)[FETCH_PATCH_FLAG]) return;

  const patched: typeof window.fetch = async (input, init) => {
    if (!isRscRequest(input, init)) return original(input, init);

    rscInFlight++;
    try {
      const res = await original(input, init);
      // A stale client asking a deployment that no longer exists is much the
      // likeliest reason a route payload fails here.
      if (!res.ok) lastRscFailedAt = Date.now();
      return res;
    } catch (err) {
      lastRscFailedAt = Date.now();
      throw err;
    } finally {
      rscInFlight--;
    }
  };

  (patched as unknown as Record<string, unknown>)[FETCH_PATCH_FLAG] = true;
  window.fetch = patched;
}

// ─── Pending navigation ──────────────────────────────────────────────────────

type Pending = {
  /** Pathname at the moment of arming — what "committed" is measured against. */
  from: string;
  /** Full target URL. Query and hash are kept: a notification action URL's
   *  `?tab=disputes` *is* the point of the link. */
  href: string;
  to: string;
  source: NavigationSource;
  armedAt: number;
  deadline: number;
  extensions: number;
  rescueAttempts: number;
  /** Non-zero while a forced navigation is expected to be taking effect. */
  rescueVerifyAt: number;
};

let pending: Pending | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (poll) {
    clearInterval(poll);
    poll = null;
  }
}

function startPolling() {
  if (poll) return;
  poll = setInterval(evaluate, POLL_MS);
}

function settle() {
  pending = null;
  stopPolling();
  setState(IDLE);
}

/**
 * Called from React when the pathname actually changes. The watchdog's own
 * check reads `window.location` (see `classifyStall`), but that only runs on
 * the poll; this settles on the same tick the route commits, so the progress
 * bar never lingers after a successful navigation.
 */
export function notifyNavigationCommitted(pathname: string) {
  if (pending && pathname !== pending.from) settle();
}

type Stall = 'committed' | 'waiting' | 'slow' | 'offline' | 'stuck' | 'dead-deployment';

function classifyStall(p: Pending): Stall {
  // `window.location` is the deliberate signal here rather than `usePathname()`:
  // the App Router pushes the history entry as part of the commit, so the URL
  // changing *is* the commit, and reading it does not depend on React having
  // rendered anything. Under the failure this guards against, React is
  // precisely what cannot be trusted to run.
  if (window.location.pathname !== p.from) return 'committed';

  if (Date.now() < p.deadline) return 'waiting';

  // A route payload that errored will error again. Only a fresh document helps.
  if (lastRscFailedAt >= p.armedAt) return 'dead-deployment';

  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';

  // Still on the wire: slow, not stuck. Do not throw the fetch away.
  if (rscInFlight > 0) return 'slow';

  // A forced reload of a window nobody is looking at is pure churn, and the
  // window being hidden is why nothing has been clicked since. Wait for the
  // user to come back — `visibilitychange` re-evaluates the moment they do.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'slow';

  // The payload landed (or was never requested) and we are still here.
  return 'stuck';
}

function rescue(p: Pending, reason: Stall) {
  p.rescueAttempts++;
  p.rescueVerifyAt = Date.now() + RESCUE_VERIFY_MS;

  // Telemetry is half the point: this says whether the hang is still happening
  // in the fleet after the config and layout fixes, on which routes, and now
  // for which reason. If these stop arriving, the cause is actually gone.
  Sentry.captureMessage('Navigation watchdog forced a hard navigation', {
    level: 'warning',
    tags: {
      area: 'navigation',
      reason: reason === 'dead-deployment' ? 'rsc-request-failed' : 'transition-never-committed',
      source: p.source,
    },
    extra: {
      from: p.from,
      to: p.to,
      href: p.href,
      attempt: p.rescueAttempts,
      extensions: p.extensions,
      waitedMs: Date.now() - p.armedAt,
      rscInFlight,
      rscFailed: lastRscFailedAt >= p.armedAt,
      stuckAfterMs: STUCK_AFTER_MS,
    },
  });

  // Attempt 1 goes where the user asked. Attempt 2 — and a failed payload,
  // which means the target route is itself what cannot load — takes a fresh
  // document of the current page instead.
  if (p.rescueAttempts >= 2 || reason === 'dead-deployment') window.location.reload();
  else window.location.assign(p.href);
}

function evaluate() {
  const p = pending;
  if (!p) {
    stopPolling();
    return;
  }

  // A rescue was issued and we are waiting to see whether it took effect.
  if (p.rescueVerifyAt) {
    if (window.location.pathname !== p.from) {
      settle();
      return;
    }
    if (Date.now() < p.rescueVerifyAt) return;

    // It did not take effect. Escalate, or hand it to the user.
    if (p.rescueAttempts >= MAX_RESCUE_ATTEMPTS) {
      p.rescueVerifyAt = 0;
      setState({ phase: 'failed', since: p.armedAt, to: p.to });
      stopPolling();
      return;
    }
    rescue(p, 'stuck');
    return;
  }

  const verdict = classifyStall(p);

  switch (verdict) {
    case 'committed':
      settle();
      return;

    case 'waiting':
      setState({ phase: 'pending', since: p.armedAt, to: p.to });
      return;

    case 'offline':
      // Held, and deliberately not counted against the extension budget: being
      // offline is not a stall the app can fix, and `NoConnectionModal` is
      // already telling the user what is wrong.
      p.deadline = Date.now() + SLOW_EXTENSION_MS;
      setState({ phase: 'offline', since: p.armedAt, to: p.to });
      return;

    case 'slow':
      if (p.extensions >= MAX_EXTENSIONS) {
        rescue(p, 'stuck');
        return;
      }
      p.extensions++;
      p.deadline = Date.now() + SLOW_EXTENSION_MS;
      setState({ phase: 'slow', since: p.armedAt, to: p.to });
      return;

    case 'dead-deployment':
    case 'stuck':
      rescue(p, verdict);
      return;
  }
}

/**
 * Arm the watchdog for a navigation about to be started imperatively.
 *
 * Call it immediately *before* `router.push(to)`. It only starts watching — it
 * never navigates on its own — so an ignored or superseded call costs nothing.
 *
 * Returns silently for anything with no transition to watch: a cross-origin or
 * external URL (use `window.open` for those), a same-path push, or anything
 * touching `/onboarding`, where a hard navigation would throw away a
 * half-filled form.
 */
export function watchNavigation(to: string, source: NavigationSource = 'notification-action') {
  if (typeof window === 'undefined') return;

  // A rescue is mid-flight; this document is on its way out. Nothing to arm.
  if (pending?.rescueVerifyAt && Date.now() < pending.rescueVerifyAt) return;

  let url: URL;
  try {
    url = new URL(to, window.location.href);
  } catch {
    return;
  }
  // Cross-origin (and `bluu://`, `mailto:` …) leave the app entirely.
  if (url.origin !== window.location.origin) return;

  const from = window.location.pathname;
  const target = url.pathname;

  // Same page, or a hash/query-only change — no route transition to watch.
  if (target === from) return;

  // Onboarding is nothing but a form; a hard navigation would discard whatever
  // the user has typed. Same reasoning as `DeploymentRefresher`.
  if (from.startsWith('/onboarding') || target.startsWith('/onboarding')) return;

  const now = Date.now();
  pending = {
    from,
    href: url.href,
    to: target,
    source,
    armedAt: now,
    deadline: now + STUCK_AFTER_MS,
    extensions: 0,
    rescueAttempts: 0,
    rescueVerifyAt: 0,
  };
  setState({ phase: 'pending', since: now, to: target });
  startPolling();
}

function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export default function NavigationWatchdog() {
  useEffect(() => {
    instrumentFetch();

    const onClick = (e: MouseEvent) => {
      if (!isPlainLeftClick(e)) return;

      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;

      // New tab / download / anything the router was never going to handle.
      if (anchor.target || anchor.hasAttribute('download')) return;

      // Evaluate the *existing* pending navigation first. A click is a real
      // user gesture and runs even when the main thread is too busy to service
      // timers — so clicking again is the escape hatch for a stuck user,
      // rather than being swallowed as "a navigation is already pending".
      evaluate();

      // A rescue just started; do not overwrite it with a fresh watch.
      if (pending?.rescueVerifyAt) return;

      watchNavigation(anchor.href, 'link');
    };

    // A navigation held back while the window was hidden, or while the
    // connection was down, is released the moment that changes.
    const recheck = () => evaluate();

    // Capture phase: `Link` calls `preventDefault()` in its own handler, so by
    // the bubble phase we could not tell "the router took this and stalled" from
    // "nothing handled it". We only observe here — never intercept — so running
    // first costs nothing.
    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    window.addEventListener('online', recheck);

    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
      window.removeEventListener('online', recheck);
      stopPolling();
    };
  }, []);

  return null;
}
