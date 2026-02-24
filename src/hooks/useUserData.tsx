'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuth } from '@/components/AuthProvider';
import { useNetworkStatus } from '@/contexts/NetworkStatusContext';
import { UserDocument } from '@/types/firestore';

interface UserDataContextType {
  userData: UserDocument | null;
  loading: boolean;
}

const UserDataContext = createContext<UserDataContextType>({ userData: null, loading: true });

export function UserDataProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user } = useAuth();
  const { reportFirestoreError } = useNetworkStatus();
  const [userData, setUserData] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setUserData(null);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          setUserData(docSnapshot.data() as UserDocument);
        }
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching user data:', error);
        reportFirestoreError(error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, reportFirestoreError]);

  return (
    <UserDataContext.Provider value={{ userData, loading }}>
      {children}
    </UserDataContext.Provider>
  );
}

export function useUserData() {
  return useContext(UserDataContext);
}
