"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase-config';
import { doc, getDoc } from 'firebase/firestore';
import { detectDeviceTimezone } from '@/lib/timezone';

export interface CreatorUser {
  uid: string;
  creatorID: string;
  userEmail: string;
  displayName: string;
  stageName: string;
  photoURL?: string | null;
  isActive: boolean;
  driveLink?: string;
  /**
   * The creator's IANA timezone, detected from their device at sign-in (see
   * `syncDeviceTimezone` below). Every due date in the product resolves against
   * this; absent, callers fall back to UTC.
   */
  defaultTimezone?: string;
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

/**
 * Push the device's timezone onto the creator record when it has changed.
 *
 * Fire-and-forget on purpose: it must never delay or block sign-in, and a
 * failure is recoverable — the next sign-in tries again, and until it lands
 * every consumer falls back to the stored value (or UTC). Guarded on a real
 * difference so a returning creator costs zero writes (cross-cutting rule 9);
 * the route re-checks the same thing server-side.
 *
 * Returns the timezone the local `creatorUser` should carry, so the portal does
 * not render a stale zone for the rest of the session.
 */
async function syncDeviceTimezone(
  stored: string | undefined,
  getToken: () => Promise<string>,
): Promise<string | undefined> {
  const detected = detectDeviceTimezone();
  if (!detected || detected === stored) return stored;

  try {
    const res = await fetch('/api/creator/timezone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await getToken()}`,
      },
      body: JSON.stringify({ timezone: detected }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return detected;
  } catch (error) {
    console.error('[CreatorAuthProvider] timezone sync failed:', error);
    return stored;
  }
}

export function CreatorAuthProvider({ children }: { children: React.ReactNode }) {
  const [creatorUser, setCreatorUser] = useState<CreatorUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const snap = await getDoc(doc(db, 'creators', currentUser.uid));
          if (snap.exists() && snap.data()?.isActive === true) {
            const data = snap.data() as CreatorUser;
            setCreatorUser(data);
            // After the session is live, never in front of it.
            void syncDeviceTimezone(
              data.defaultTimezone,
              () => currentUser.getIdToken(),
            ).then(tz => {
              if (tz !== data.defaultTimezone) {
                setCreatorUser(prev => (prev ? { ...prev, defaultTimezone: tz } : prev));
              }
            });
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
