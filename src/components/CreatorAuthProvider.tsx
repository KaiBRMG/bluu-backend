"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase-config';
import { doc, getDoc } from 'firebase/firestore';

export interface CreatorUser {
  uid: string;
  creatorID: string;
  userEmail: string;
  displayName: string;
  stageName: string;
  photoURL?: string | null;
  isActive: boolean;
  driveLink?: string;
}

interface CreatorAuthContextType {
  creatorUser: CreatorUser | null;
  loading: boolean;
}

const CreatorAuthContext = createContext<CreatorAuthContextType>({
  creatorUser: null,
  loading: true,
});

export const useCreatorAuth = () => useContext(CreatorAuthContext);

export function CreatorAuthProvider({ children }: { children: React.ReactNode }) {
  const [creatorUser, setCreatorUser] = useState<CreatorUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const snap = await getDoc(doc(db, 'creators', currentUser.uid));
          if (snap.exists() && snap.data()?.isActive === true) {
            setCreatorUser(snap.data() as CreatorUser);
          } else {
            await auth.signOut();
            setCreatorUser(null);
          }
        } catch {
          await auth.signOut();
          setCreatorUser(null);
        }
      } else {
        setCreatorUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <CreatorAuthContext.Provider value={{ creatorUser, loading }}>
      {children}
    </CreatorAuthContext.Provider>
  );
}
