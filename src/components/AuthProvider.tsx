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
      // Handled recovery (we fail open to the Login screen), not a crash —
      // log as a warning so it's a signal of how often the hang happens
      // without polluting the error feed.
      Sentry.captureMessage('Auth state resolution timed out', {
        level: 'warning',
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
          // This single read answers two questions at once:
          //
          //  1. **Is this an employee at all?** It used to be decided by the
          //     email domain, but staff now sign in with personal addresses, so
          //     a domain test would sign out every employee. Owning a `users`
          //     doc is what makes someone an internal user. Creator accounts
          //     have a `creators` doc and no `users` doc — they are handled by
          //     CreatorAuthProvider in the creator portal (a separate layout
          //     that never mounts this provider), and must not be signed out
          //     from here, only ignored.
          //  2. **Is that employee still active?**
          //
          // A genuinely ABSENT doc now means "not an internal user" and must
          // deny — the opposite of the old fail-open. A read that THREW still
          // fails open (see below): "we couldn't ask" is not "the answer is no".
          let isActive = true;
          let isEmployee = true;
          try {
            const snap = await getDoc(doc(db, 'users', currentUser.uid));
            isEmployee = snap.exists();
            isActive = isEmployee && snap.data()?.isActive !== false;
            try {
              sessionStorage.setItem(ACTIVE_CACHE_KEY, JSON.stringify({
                uid: currentUser.uid, active: isActive, at: Date.now(),
              }));
            } catch { /* non-fatal */ }
          } catch (err) {
            // Read failed — fall through as active so we don't wedge boot. Log
            // it: a failing isActive read on boot is the throw-path counterpart
            // to the timeout above (blocked/offline Firestore on the device).
            //
            // Fail-open is safe here because it grants only a *shell*: every
            // API route re-authorises server-side, and the mid-session
            // kill-switch in AuthWrapper revokes access once connectivity
            // returns. It is not safe to fail open on a doc we successfully
            // read and found missing, which is why that case is separate.
            Sentry.captureException(err, {
              tags: { area: 'auth-boot', reason: 'isActive-read-failed' },
            });
          }

          // Not an internal user (creator session, or a user deleted mid-session).
          // Clear our state without signing them out — the creator portal owns
          // that session.
          if (!isEmployee) {
            setUser(null);
            setLoading(false);
            return;
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
