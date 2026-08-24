"use client";

import { useEffect, useRef } from 'react';
import { useAuth } from './AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import Login from './Login';
import { usePathname, useRouter } from 'next/navigation';
import { auth } from '@/firebase-config';
import { useBootPhase } from '@/contexts/BootLoaderContext';
import {
  computeDynamicSize,
  readSavedSize,
  saveSize,
  clearSavedSize,
  readWorkArea,
  fitToWorkArea,
} from '@/lib/windowSize';
import { clearLoginSession, hasLoginSession } from '@/lib/loginSession';

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, loading, revokedRedirect } = useAuth();
  const { userData, loading: userDataLoading, displaced } = useUserData();
  const { clockOutAndFlush } = useTimeTrackingContext();
  const pathname = usePathname();
  const router = useRouter();

  // Guards the displaced handler against a re-run (StrictMode, or a re-render
  // before signOut settles) firing a second clock-out.
  const hasHandledDisplacedRef = useRef(false);

  // Same purpose for the incomplete-onboarding discard: one sign-out per mount,
  // even if StrictMode double-invokes or a re-render lands before it settles.
  const hasDiscardedRef = useRef(false);

  // Hold the boot loader while Firebase auth resolves.
  useBootPhase('auth', loading);

  const isLoggedIn = !!user;
  const prevIsLoggedInRef = useRef<boolean>(isLoggedIn);
  const hasSignaledReady = useRef(false);

  // Routes that render with no internal-employee session at all: the OAuth pages
  // and the creator portal (which runs its own auth context). The `/creator`
  // check must be segment-bounded — a bare startsWith('/creator') would also
  // swallow the internal staff pages at `/creator-portal/*` and silently skip session
  // enforcement there.
  const isUnauthenticatedRoute =
    pathname?.startsWith('/auth/') ||
    pathname === '/creator' ||
    pathname?.startsWith('/creator/');

  // Onboarding IS an authenticated surface, so session enforcement (revocation,
  // displacement, the incomplete-onboarding discard) must run there. Only the
  // onboarding guard itself skips it, or it would redirect in a loop.
  const isOnboardingRoute = pathname?.startsWith('/onboarding/');

  // Signal the Electron main process that React has mounted and auth state has resolved.
  // Fires once per session — gives main.js a hook to dismiss splash screens or log readiness.
  useEffect(() => {
    if (loading) return;
    if (hasSignaledReady.current) return;
    hasSignaledReady.current = true;
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.app.signalReady?.();
    }
  }, [loading]);

  // Redirect to revoked page if AuthProvider detected isActive=false at login time
  useEffect(() => {
    if (revokedRedirect) {
      router.replace('/auth/revoked');
    }
  }, [revokedRedirect, router]);

  // Control window sizing + resizability based on login state.
  // On login: restore the remembered size (fitted to the display the window is actually
  // on), or size dynamically to 85%×80% of that work area when there is none. On logout:
  // forget the remembered size so the next login re-runs the dynamic sizing, and re-lock
  // the window for the login page.
  useEffect(() => {
    if (prevIsLoggedInRef.current === isLoggedIn) return;
    prevIsLoggedInRef.current = isLoggedIn;

    if (typeof window === 'undefined' || !window.electronAPI?.window) return;
    const windowApi = window.electronAPI.window;

    if (!isLoggedIn) {
      clearSavedSize();
      windowApi.setResizable(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const workArea = await readWorkArea();
      if (cancelled) return;

      // A saved size exists only if the user manually resized. Its presence is what
      // suppresses auto-sizing; logout clears it, so the next login auto-sizes again.
      const saved = readSavedSize();
      const size = saved ? fitToWorkArea(saved, workArea) : computeDynamicSize(workArea);

      // Resizable first — maximize() is a no-op on a locked window.
      windowApi.setResizable(true);
      windowApi.setSize(size.width, size.height);
      if (saved?.maximized) windowApi.maximize?.();
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  // Persist the window size ONLY when the user resizes it by hand (Electron + logged in).
  // This must not listen to the DOM `resize` event: that also fires for the auto-size we
  // issue on login, which would persist the auto-sized value and stop auto-sizing from
  // ever running again. `onUserResized` is emitted by the main process for a finished
  // user drag / maximize / unmaximize only, and reports the last **non-maximized** size
  // alongside the maximize flag (maximized bounds exceed the display on Windows).
  //
  // Absent on installed builds predating this IPC — those simply never persist a size and
  // auto-size on every launch, which is the correct default rather than a regression.
  useEffect(() => {
    if (!isLoggedIn) return;
    if (typeof window === 'undefined') return;
    const windowApi = window.electronAPI?.window;
    if (!windowApi?.onUserResized) return;

    windowApi.onUserResized((state) => {
      saveSize(state.width, state.height, state.isMaximized);
    });
    return () => windowApi.removeUserResizedListener?.();
  }, [isLoggedIn]);

  // Mid-session kill-switch: fires when an admin revokes access while the user is logged in.
  // useUserData uses onSnapshot — 0 extra reads while isActive stays true.
  useEffect(() => {
    if (!user || userDataLoading || isUnauthenticatedRoute) return;
    if (userData && userData.isActive === false) {
      auth.signOut().then(() => {
        router.replace('/auth/revoked');
      });
    }
  }, [userData, userDataLoading, user, isUnauthenticatedRoute, router]);

  // Single active session enforcement: sign out and redirect if another device logged in.
  // The timer is clocked out first — a displaced user cannot reach the Clock Out button,
  // so without this their session stays open (and renders as live) until the daily
  // stale-session Cloud Function closes it hours later.
  useEffect(() => {
    if (!user || userDataLoading || isUnauthenticatedRoute) return;
    if (!displaced || hasHandledDisplacedRef.current) return;
    hasHandledDisplacedRef.current = true;

    (async () => {
      try {
        await clockOutAndFlush();
      } catch (err) {
        console.error('[AuthWrapper] Clock-out on displaced logout failed:', err);
      }
      localStorage.removeItem('sessionToken');
      clearLoginSession();
      await auth.signOut();
      router.replace('/auth/displaced');
    })();
  }, [displaced, userDataLoading, user, isUnauthenticatedRoute, router, clockOutAndFlush]);

  // Onboarding is all-or-nothing: a run that never reached "Submit details" is
  // discarded, and the user starts over from the login screen. `ensureUserExists`
  // clears the partial data server-side on the next login; this is the client
  // half — end the restored session so they actually land on Login.
  //
  // Gated on the login-session marker, which lives in sessionStorage and so
  // exists only for the run the user actually signed in on. That is what
  // separates "auth restored from disk on relaunch" (discard) from "signed in a
  // moment ago and is mid-flow" (leave alone).
  useEffect(() => {
    if (!user || userDataLoading || !userData || isUnauthenticatedRoute) return;
    if (userData.hasCompletedOnboarding === true) return;
    if (hasLoginSession() || hasDiscardedRef.current) return;
    hasDiscardedRef.current = true;

    (async () => {
      localStorage.removeItem('sessionToken');
      await auth.signOut();
      router.replace('/');
    })();
  }, [userData, userDataLoading, user, isUnauthenticatedRoute, router]);

  // Onboarding guard: redirect to the appropriate onboarding step if not completed
  useEffect(() => {
    if (!user || userDataLoading || isUnauthenticatedRoute || isOnboardingRoute) return;
    if (!userData) return;

    if (userData.hasAcceptedTerms !== true) {
      router.replace('/onboarding/welcome');
      return;
    }
    if (userData.hasCompletedOnboarding !== true) {
      router.replace('/onboarding/permissions');
      return;
    }
  }, [userData, userDataLoading, user, isUnauthenticatedRoute, isOnboardingRoute, router]);

  // While auth resolves, render nothing — the persistent boot loader (rendered by
  // BootLoaderProvider above this component) covers the screen.
  if (loading) {
    return null;
  }

  // Only the OAuth pages and the creator portal render without a session.
  // Onboarding must fall through to the `!user` check below — it used to be
  // grouped with them, which meant signing out from an onboarding step cleared
  // the session but kept rendering the step, so the button looked inert.
  if (isUnauthenticatedRoute) {
    return <>{children}</>;
  }

  if (!user) {
    return <Login />;
  }

  return <>{children}</>;
}
