"use client";

import { useEffect, useRef } from 'react';
import { useAuth } from './AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import Login from './Login';
import { usePathname, useRouter } from 'next/navigation';
import { auth } from '@/firebase-config';
import { useBootPhase } from '@/contexts/BootLoaderContext';
import { computeDynamicSize, readSavedSize, saveSize, clearSavedSize } from '@/lib/windowSize';

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, loading, revokedRedirect } = useAuth();
  const { userData, loading: userDataLoading, displaced } = useUserData();
  const { clockOutAndFlush } = useTimeTrackingContext();
  const pathname = usePathname();
  const router = useRouter();

  // Guards the displaced handler against a re-run (StrictMode, or a re-render
  // before signOut settles) firing a second clock-out.
  const hasHandledDisplacedRef = useRef(false);

  // Hold the boot loader while Firebase auth resolves.
  useBootPhase('auth', loading);

  const isLoggedIn = !!user;
  const prevIsLoggedInRef = useRef<boolean>(isLoggedIn);
  const hasSignaledReady = useRef(false);

  const isAuthRoute =
    pathname?.startsWith('/auth/') ||
    pathname?.startsWith('/onboarding/') ||
    pathname?.startsWith('/creator-portal');

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
  // On login: restore the remembered size, or size dynamically to 85%×80% of the display
  // when there is none. On logout: forget the remembered size so the next login re-runs the
  // dynamic sizing, and re-lock the window for the login page.
  useEffect(() => {
    if (prevIsLoggedInRef.current !== isLoggedIn) {
      prevIsLoggedInRef.current = isLoggedIn;

      if (typeof window !== 'undefined' && window.electronAPI?.window) {
        if (isLoggedIn) {
          const size = readSavedSize() ?? computeDynamicSize();
          window.electronAPI.window.setSize(size.width, size.height);
          window.electronAPI.window.setResizable(true);
        } else {
          clearSavedSize();
          window.electronAPI.window.setResizable(false);
        }
      }
    }
  }, [isLoggedIn]);

  // Persist the user's window size whenever they resize (Electron + logged in only).
  useEffect(() => {
    if (!isLoggedIn) return;
    if (typeof window === 'undefined' || !window.electronAPI?.window?.getSize) return;

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const size = await window.electronAPI!.window.getSize?.();
        if (size) saveSize(size[0], size[1]);
      }, 300);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      if (timeout) clearTimeout(timeout);
      window.removeEventListener('resize', handleResize);
    };
  }, [isLoggedIn]);

  // Mid-session kill-switch: fires when an admin revokes access while the user is logged in.
  // useUserData uses onSnapshot — 0 extra reads while isActive stays true.
  useEffect(() => {
    if (!user || userDataLoading || isAuthRoute) return;
    if (userData && userData.isActive === false) {
      auth.signOut().then(() => {
        router.replace('/auth/revoked');
      });
    }
  }, [userData, userDataLoading, user, isAuthRoute, router]);

  // Single active session enforcement: sign out and redirect if another device logged in.
  // The timer is clocked out first — a displaced user cannot reach the Clock Out button,
  // so without this their session stays open (and renders as live) until the daily
  // stale-session Cloud Function closes it hours later.
  useEffect(() => {
    if (!user || userDataLoading || isAuthRoute) return;
    if (!displaced || hasHandledDisplacedRef.current) return;
    hasHandledDisplacedRef.current = true;

    (async () => {
      try {
        await clockOutAndFlush();
      } catch (err) {
        console.error('[AuthWrapper] Clock-out on displaced logout failed:', err);
      }
      localStorage.removeItem('sessionToken');
      await auth.signOut();
      router.replace('/auth/displaced');
    })();
  }, [displaced, userDataLoading, user, isAuthRoute, router, clockOutAndFlush]);

  // Onboarding guard: redirect to the appropriate onboarding step if not completed
  useEffect(() => {
    if (!user || userDataLoading || isAuthRoute) return;
    if (!userData) return;

    if (userData.hasAcceptedTerms !== true) {
      router.replace('/onboarding/welcome');
      return;
    }
    if (userData.hasCompletedOnboarding !== true) {
      router.replace('/onboarding/permissions');
      return;
    }
  }, [userData, userDataLoading, user, isAuthRoute, router]);

  // While auth resolves, render nothing — the persistent boot loader (rendered by
  // BootLoaderProvider above this component) covers the screen.
  if (loading) {
    return null;
  }

  if (isAuthRoute) {
    return <>{children}</>;
  }

  if (!user) {
    return <Login />;
  }

  return <>{children}</>;
}
