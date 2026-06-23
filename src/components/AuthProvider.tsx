"use client";

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase-config';
import { doc, getDoc } from 'firebase/firestore';
import * as Sentry from '@sentry/nextjs';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  revokedRedirect: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, revokedRedirect: false });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokedRedirect, setRevokedRedirect] = useState(false);

  useEffect(() => {
    const ACTIVE_CACHE_KEY = 'bluu_auth_active_check';
    const ACTIVE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

    // Failsafe: Firebase restores auth state from IndexedDB before firing the
    // callback below. On some devices that local read can hang (corrupt/blocked
    // IndexedDB, persistence-layer init stall) and `onAuthStateChanged` never
    // fires — which would pin `loading: true` and trap the app on the boot
    // loader forever. If we haven't heard from Firebase in time, give up waiting
    // and resolve as logged-out so AuthWrapper can render the Login screen.
    const AUTH_TIMEOUT_MS = 12000;
    let authResolved = false;
    const authTimeout = setTimeout(() => {
      if (authResolved) return;
      // onAuthStateChanged never fired within the window — almost always a
      // hung local (IndexedDB) auth-state restore on the user's device. Report
      // it so we can see how often this happens in the wild; the fail-open
      // below still lets them reach the Login screen.
      Sentry.captureMessage('Auth state resolution timed out', {
        level: 'error',
        tags: { area: 'auth-boot', reason: 'onAuthStateChanged-timeout' },
        extra: { timeoutMs: AUTH_TIMEOUT_MS },
      });
      setUser(null);
      setLoading(false);
    }, AUTH_TIMEOUT_MS);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      authResolved = true;
      clearTimeout(authTimeout);
      if (currentUser && currentUser.email) {
        // Only manage auth state for internal employees (@bluurock.com).
        // Creator accounts (non-bluurock email) are handled by CreatorAuthProvider
        // in the creator portal — do not sign them out from here.
        if (!currentUser.email.endsWith('@bluurock.com')) {
          setUser(null);
          setLoading(false);
          return;
        }

        // Check isActive — use sessionStorage cache to avoid Firestore reads
        // on every auth state change (token refresh, tab reactivation, etc.)
        let needsCheck = true;
        try {
          const raw = sessionStorage.getItem(ACTIVE_CACHE_KEY);
          if (raw) {
            const cached = JSON.parse(raw) as { uid: string; active: boolean; at: number };
            if (cached.uid === currentUser.uid && Date.now() - cached.at < ACTIVE_CACHE_TTL) {
              needsCheck = false;
              if (!cached.active) {
                await auth.signOut();
                setUser(null);
                setRevokedRedirect(true);
                setLoading(false);
                return;
              }
            }
          }
        } catch { /* cache miss — fall through to Firestore check */ }

        if (needsCheck) {
          // Fail open: if this read throws (offline, blocked googleapis.com,
          // flaky link — common on a brand-new device), we must NOT let the
          // exception escape, or `setLoading(false)` below never runs and the
          // boot loader hangs forever. Treat an unreadable doc as active; the
          // mid-session kill-switch in AuthWrapper (onSnapshot on the user doc)
          // still revokes access if isActive becomes false once connectivity
          // returns.
          let isActive = true;
          try {
            const snap = await getDoc(doc(db, 'users', currentUser.uid));
            isActive = !snap.exists() || snap.data()?.isActive !== false;
            try {
              sessionStorage.setItem(ACTIVE_CACHE_KEY, JSON.stringify({
                uid: currentUser.uid, active: isActive, at: Date.now(),
              }));
            } catch { /* non-fatal */ }
          } catch (err) {
            // Read failed — fall through as active so we don't wedge boot. Log
            // it: a failing isActive read on boot is the throw-path counterpart
            // to the timeout above (blocked/offline Firestore on the device).
            Sentry.captureException(err, {
              tags: { area: 'auth-boot', reason: 'isActive-read-failed' },
            });
          }
          if (!isActive) {
            await auth.signOut();
            setUser(null);
            setRevokedRedirect(true);
            setLoading(false);
            return;
          }
        }

        setRevokedRedirect(false);
        setUser(currentUser);
      } else {
        setUser(null);
        try { sessionStorage.removeItem(ACTIVE_CACHE_KEY); } catch { /* ignore */ }
      }
      setLoading(false);
    });

    return () => {
      clearTimeout(authTimeout);
      unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ user, loading, revokedRedirect }), [user, loading, revokedRedirect]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
