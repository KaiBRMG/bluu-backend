'use client';
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuth } from '@/components/AuthProvider';
import { useNetworkStatus } from '@/contexts/NetworkStatusContext';
import { UserDocument } from '@/types/firestore';

export function useUserData() {
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

    // Real-time listener for user document
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

  return { userData, loading };
}
