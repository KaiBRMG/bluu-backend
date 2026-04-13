"use client";

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase-config';
import { doc, getDoc } from 'firebase/firestore';

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

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser && currentUser.email) {
        // Verify the email domain
        if (!currentUser.email.endsWith('@bluurock.com')) {
          await auth.signOut();
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
          const snap = await getDoc(doc(db, 'users', currentUser.uid));
          const isActive = !snap.exists() || snap.data()?.isActive !== false;
          try {
            sessionStorage.setItem(ACTIVE_CACHE_KEY, JSON.stringify({
              uid: currentUser.uid, active: isActive, at: Date.now(),
            }));
          } catch { /* non-fatal */ }
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

    return () => unsubscribe();
  }, []);

  const value = useMemo(() => ({ user, loading, revokedRedirect }), [user, loading, revokedRedirect]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
