"use client";

import { createContext, useContext, useEffect, useState } from 'react';
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
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser && currentUser.email) {
        // Verify the email domain
        if (!currentUser.email.endsWith('@bluurock.com')) {
          await auth.signOut();
          setUser(null);
          setLoading(false);
          return;
        }

        // Check isActive before allowing any page to render
        const snap = await getDoc(doc(db, 'users', currentUser.uid));
        if (snap.exists() && snap.data()?.isActive === false) {
          await auth.signOut();
          setUser(null);
          setRevokedRedirect(true);
          setLoading(false);
          return;
        }

        setRevokedRedirect(false);
        setUser(currentUser);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, revokedRedirect }}>
      {children}
    </AuthContext.Provider>
  );
}
