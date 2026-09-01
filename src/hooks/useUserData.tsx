'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuth } from '@/components/AuthProvider';
import { useNetworkStatus } from '@/contexts/NetworkStatusContext';
import { getDeviceId } from '@/lib/deviceId';
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

          // Session enforcement, per DEVICE rather than per user.
          //
          // `users/{uid}.sessions[deviceId].token` is the authority when an entry
          // for this device exists: a desktop login evicts other desktop
          // entries, a revocation rotates one, and either way this client's own
          // token stops matching. Web sessions coexist with the desktop one.
          //
          // The legacy single `sessionToken` is the fallback, and MUST stay one.
          // A session established before device identity shipped has no entry in
          // the map, and a client that cannot mint a device id (storage blocked)
          // never will — treating either as "revoked" would sign out a user who
          // did nothing wrong. See lib/services/sessionService.ts.
          const localToken = localStorage.getItem('sessionToken');
          const deviceId = getDeviceId();
          const sessions = (data as { sessions?: Record<string, { token?: string }> }).sessions;
          const entry = deviceId && sessions ? sessions[deviceId] : undefined;

          const revoked = entry
            ? !!localToken && !!entry.token && entry.token !== localToken
            : !!localToken && !!data.sessionToken && data.sessionToken !== localToken;

          if (revoked) {
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
