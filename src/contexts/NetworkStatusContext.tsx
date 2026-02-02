'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuth } from '@/components/AuthProvider';
import NoConnectionModal from '@/components/NoConnectionModal';

interface NetworkStatusContextType {
  isOnline: boolean;
  reportFirestoreError: (error: Error) => void;
}

const NetworkStatusContext = createContext<NetworkStatusContextType>({
  isOnline: true,
  reportFirestoreError: () => {},
});

export const useNetworkStatus = () => useContext(NetworkStatusContext);

interface NetworkStatusProviderProps {
  children: ReactNode;
}

export function NetworkStatusProvider({ children }: NetworkStatusProviderProps) {
  const { user } = useAuth();
  const [browserOnline, setBrowserOnline] = useState(true);
  const [firebaseConnected, setFirebaseConnected] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const verificationInProgressRef = useRef(false);

  // Initialize browser online state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBrowserOnline(navigator.onLine);
    }
  }, []);

  // Browser online/offline event listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setBrowserOnline(true);
    };

    const handleOffline = () => {
      setBrowserOnline(false);
      setFirebaseConnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Verify Firebase connectivity when browser comes back online
  const verifyFirebaseConnection = useCallback(async () => {
    if (verificationInProgressRef.current) return;
    if (!user) {
      // If no user, just trust browser status
      setFirebaseConnected(true);
      return;
    }

    verificationInProgressRef.current = true;

    try {
      // Attempt a lightweight Firestore read to verify connectivity
      await getDoc(doc(db, 'users', user.uid));
      setFirebaseConnected(true);
    } catch (error: unknown) {
      const errorCode = (error as { code?: string })?.code;
      if (errorCode === 'unavailable' || errorCode === 'unknown') {
        setFirebaseConnected(false);
      } else {
        // Other errors don't indicate connectivity issues
        setFirebaseConnected(true);
      }
    } finally {
      verificationInProgressRef.current = false;
    }
  }, [user]);

  // Handle Firestore errors reported from listeners
  const reportFirestoreError = useCallback((error: Error) => {
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'unavailable' || errorCode === 'unknown') {
      setFirebaseConnected(false);
    }
  }, []);

  // Determine if we should show the modal
  useEffect(() => {
    // Clear any pending reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const isConnected = browserOnline && firebaseConnected;

    if (!isConnected) {
      // Show modal immediately when offline
      setShowModal(true);
    } else if (showModal) {
      // Debounce hiding the modal to prevent flicker
      reconnectTimeoutRef.current = setTimeout(() => {
        setShowModal(false);
      }, 2000);
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [browserOnline, firebaseConnected, showModal]);

  // When browser comes back online, verify Firebase connection
  useEffect(() => {
    if (browserOnline && !firebaseConnected) {
      const intervalId = setInterval(() => {
        verifyFirebaseConnection();
      }, 3000);

      // Also verify immediately
      verifyFirebaseConnection();

      return () => clearInterval(intervalId);
    }
  }, [browserOnline, firebaseConnected, verifyFirebaseConnection]);

  const isOnline = browserOnline && firebaseConnected;

  return (
    <NetworkStatusContext.Provider value={{ isOnline, reportFirestoreError }}>
      {children}
      {showModal && <NoConnectionModal />}
    </NetworkStatusContext.Provider>
  );
}
