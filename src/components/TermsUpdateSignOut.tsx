'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { auth } from '@/firebase-config';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { clearPermissionsCache } from '@/lib/permissionsCache';
import { termsAcceptanceIsStale } from '@/lib/terms';
import { isUpdateInFlight } from '@/lib/updateInFlight';
import { hasUnsavedTyping } from '@/lib/unsavedTyping';

/**
 * Signs an employee out when the Terms of Use have been updated since they last
 * signed in — at a moment that costs them nothing.
 *
 * ── Why a sign-out, and why it counts as acceptance ─────────────────────────
 * The agreement is re-affirmed at every sign-in (the notice above Login's
 * button). A renderer that stays open for weeks never passes that screen, so
 * without this a user could run indefinitely under text they were never shown.
 * Ending their session routes them back through it. Each login stamps
 * `users/{uid}.acceptedTermsVersion` server-side (`recordSuccessfulLogin`); this
 * compares that stamp to the version the deployment publishes.
 *
 * ── When it fires: ALL of these, at once ────────────────────────────────────
 *  1. **`clocked-out`** — an allowlist of one state, the same rule as
 *     `DeploymentRefresher`. `idle`, `paused` and `on-break` all mean a shift
 *     is open; never end one. Sign-out while clocked in is not this component's
 *     decision to make.
 *  2. **Inactive for `IDLE_MS`** — no pointer, key, wheel, touch or focus input
 *     in this window for that long, *and* clocked out for that long. The second
 *     half is what protects the user who has just clocked out and is still
 *     using the app: clocking out is itself input, and an automatic clock-out
 *     (idle timeout) starts the same clock — nobody is signed out the moment
 *     their shift ends. A sleep gap counts as inactivity, correctly.
 *  3. The page is not onboarding or an `/auth/` page, no desktop update is
 *     downloading, the machine is online, and nothing typed would be lost.
 *  4. The published version is newer than the user's stamp (below).
 *  5. It has not already signed this user out for this version on this device
 *     (the loop guard).
 *
 * ── The version is read over HTTP (rule 9c) ─────────────────────────────────
 * Never from a constant compiled into the bundle: a renderer weeks old would
 * compare against a stale copy. `GET /api/terms/version` is CDN-cached, and is
 * asked **only at the moment this would act** (every other condition already
 * met), then remembered for `RECHECK_MS` — so it is not a poll, and a user who
 * is clocked in all day never triggers a request.
 *
 * ── Loop guard ──────────────────────────────────────────────────────────────
 * A sign-out for version V is recorded per uid in localStorage before it
 * happens. If the user signs back in and their stamp is *still* behind (a login
 * path that failed to stamp), a second sign-out for the same V is refused —
 * otherwise they would be bounced out every 20 idle minutes forever.
 *
 * ── Soft enforcement ────────────────────────────────────────────────────────
 * This is a cooperative, renderer-side mechanism, like the email-migration
 * card: it signs out a client that runs it. It is not a server-side lock — it
 * cannot stop a modified client, and does not revoke refresh tokens.
 *
 * Main window only (mounted in `(main)/layout.tsx`); a satellite window must
 * not end a session under an operator.
 */

/** Inactivity (and time clocked out) required before a stale session is ended. */
const IDLE_MS = 20 * 60 * 1000;
const TICK_MS = 30 * 1000;
/** How long an answer from `/api/terms/version` is trusted before asking again. */
const RECHECK_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8 * 1000;
const SIGNED_OUT_MARKER = 'bluu:terms-signout:';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

function markerKey(uid: string, version: string): string {
  return `${SIGNED_OUT_MARKER}${uid}:${version}`;
}

function readMarker(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeMarker(key: string): void {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage unavailable — the stamp check alone still bounds this.
  }
}

async function fetchRequiredVersion(): Promise<string | null> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch('/api/terms/version', { signal: ctl.signal });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const v = data && typeof data === 'object' ? (data as { version?: unknown }).version : null;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export default function TermsUpdateSignOut() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const { displayState } = useTimeTrackingContext();
  const pathname = usePathname();
  const router = useRouter();

  // Everything the tick reads is held in refs: it is registered once, and a
  // re-registration would reset nothing useful but could drop a pending check.
  const uidRef = useRef<string | null>(null);
  const acceptedRef = useRef<string | undefined>(undefined);
  const userDataReadyRef = useRef(false);
  const displayStateRef = useRef(displayState);
  const pathnameRef = useRef(pathname);

  const lastActivityRef = useRef(Date.now());
  const clockedOutSinceRef = useRef<number | null>(null);
  const requiredRef = useRef<{ version: string; at: number } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => { uidRef.current = user?.uid ?? null; }, [user]);
  useEffect(() => {
    userDataReadyRef.current = !!userData;
    acceptedRef.current = userData?.acceptedTermsVersion;
  }, [userData]);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  // The clock-out transition starts the "clocked out for a while" timer; any
  // other state clears it. The provider starts in `clocked-out` before it has
  // hydrated a live session, so the stamp can begin at mount — if the user is in
  // fact mid-shift it is cleared as soon as the real state lands, and it needs
  // IDLE_MS of unbroken clocked-out time to matter regardless.
  useEffect(() => {
    displayStateRef.current = displayState;
    if (displayState === 'clocked-out') {
      if (clockedOutSinceRef.current === null) clockedOutSinceRef.current = Date.now();
    } else {
      clockedOutSinceRef.current = null;
    }
  }, [displayState]);

  /** Every condition that does not need the network. Re-run after an await. */
  const eligible = useCallback((): boolean => {
    if (!uidRef.current || !userDataReadyRef.current) return false;
    if (displayStateRef.current !== 'clocked-out') return false;
    const since = clockedOutSinceRef.current;
    if (since === null) return false;
    if (Date.now() - Math.max(lastActivityRef.current, since) < IDLE_MS) return false;

    const path = pathnameRef.current;
    if (path?.startsWith('/onboarding') || path?.startsWith('/auth/')) return false;
    if (isUpdateInFlight()) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    if (hasUnsavedTyping()) return false;
    return true;
  }, []);

  const check = useCallback(async () => {
    if (busyRef.current || !eligible()) return;
    busyRef.current = true;
    try {
      let required = requiredRef.current;
      if (!required || Date.now() - required.at >= RECHECK_MS) {
        const version = await fetchRequiredVersion();
        if (!version) return; // unreachable or malformed — never a reason to sign out
        required = { version, at: Date.now() };
        requiredRef.current = required;
      }

      if (!termsAcceptanceIsStale(required.version, acceptedRef.current)) return;

      // The world may have moved while we were asking.
      const uid = uidRef.current;
      if (!uid || !eligible()) return;

      const key = markerKey(uid, required.version);
      if (readMarker(key)) {
        console.warn(
          '[TermsUpdateSignOut] already signed this user out for terms',
          required.version,
          '— their stamp is still behind; not repeating.',
        );
        return;
      }
      writeMarker(key);

      // Already clocked out, so there is nothing to flush (clockOutAndFlush is a
      // no-op in this state) — only the local session to clear.
      clearPermissionsCache();
      try { localStorage.removeItem('sessionToken'); } catch { /* ignore */ }
      await auth.signOut();
      router.replace('/auth/terms-updated');
    } catch (error) {
      console.error('[TermsUpdateSignOut] sign-out failed:', error);
    } finally {
      busyRef.current = false;
    }
  }, [eligible, router]);

  useEffect(() => {
    const onActivity = () => { lastActivityRef.current = Date.now(); };
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true, capture: true });
    }
    // Coming back to the window is activity too.
    window.addEventListener('focus', onActivity);

    const ticker = setInterval(() => { void check(); }, TICK_MS);
    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity, { capture: true });
      }
      window.removeEventListener('focus', onActivity);
      clearInterval(ticker);
    };
  }, [check]);

  return null;
}
