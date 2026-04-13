"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase-config';
import { doc, getDoc } from 'firebase/firestore';

export interface CreatorUser {
  uid: string;
  email: string;
  displayName: string;
  stageName: string;
  isActive: boolean;
}

interface CreatorAuthContextType {
  firebaseUser: User | null;
  creatorUser: CreatorUser | null;
  loading: boolean;
}

const CreatorAuthContext = createContext<CreatorAuthContextType>({
  firebaseUser: null,
  creatorUser: null,
  loading: true,
});

export const useCreatorAuth = () => useContext(CreatorAuthContext);

export function CreatorAuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [creatorUser, setCreatorUser] = useState<CreatorUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Only handle non-bluurock accounts — internal employees are managed by AuthProvider
      if (currentUser && currentUser.email && !currentUser.email.endsWith('@bluurock.com')) {
        const snap = await getDoc(doc(db, 'creators', currentUser.uid));
        if (snap.exists() && snap.data()?.isActive === true) {
          setFirebaseUser(currentUser);
          setCreatorUser(snap.data() as CreatorUser);
        } else {
          // Not a valid creator — sign out
          await auth.signOut();
          setFirebaseUser(null);
          setCreatorUser(null);
        }
      } else {
        setFirebaseUser(null);
        setCreatorUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <CreatorAuthContext.Provider value={{ firebaseUser, creatorUser, loading }}>
      {children}
    </CreatorAuthContext.Provider>
  );
}
