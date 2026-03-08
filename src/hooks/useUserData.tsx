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
  displaced: boolean;
}

const UserDataContext = createContext<UserDataContextType>({ userData: null, loading: true, displaced: false });

export function UserDataProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user } = useAuth();
  const { reportFirestoreError } = useNetworkStatus();
  const [userData, setUserData] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [displaced, setDisplaced] = useState(false);

  useEffect(() => {
    if (!user) {
      setUserData(null);
      setDisplaced(false);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data() as UserDocument;

          // Single active session enforcement: if the session token in Firestore
          // doesn't match what we stored locally at login, another device has
          // logged in and this session should be terminated.
          const localToken = localStorage.getItem('sessionToken');
          if (localToken && data.sessionToken && data.sessionToken !== localToken) {
            setDisplaced(true);
            setLoading(false);
            return;
          }

          setUserData(data);
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
    <UserDataContext.Provider value={{ userData, loading, displaced }}>
      {children}
    </UserDataContext.Provider>
  );
}

export function useUserData() {
  return useContext(UserDataContext);
}
