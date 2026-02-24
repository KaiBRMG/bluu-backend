'use client';

import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/firebase-config';
import type { ActiveSessionState } from '@/types/firestore';

export interface ActiveUserSummary {
  userId: string;
  sessionId: string;
  currentState: ActiveSessionState;
  startTime: Date;
  lastUpdated: Date;
}

/**
 * Real-time listener on the active_sessions collection.
 * Returns a list of users who are currently clocked in (userClockOut === false).
 *
 * Uses the client-side Firestore SDK so updates are pushed without polling.
 * With ≤100 users the collection is well within free-tier listener limits.
 *
 * Firestore rules: admin users can read all documents via the `list` rule.
 * Only mount this hook in admin-gated components.
 *
 * On permission error (e.g. transient token propagation delay), retries once
 * after 2 seconds before giving up.
 */
export function useActiveUsers(): { activeSessions: ActiveUserSummary[]; isLoading: boolean } {
  const [activeSessions, setActiveSessions] = useState<ActiveUserSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let retryCount = 0;

    const subscribe = () => {
      const q = query(
        collection(db, 'active_sessions'),
        where('userClockOut', '==', false),
      );

      unsub = onSnapshot(
        q,
        (snap) => {
          const sessions: ActiveUserSummary[] = snap.docs.map(doc => {
            const data = doc.data();
            return {
              userId:       data.userId as string,
              sessionId:    data.sessionId as string,
              currentState: data.currentState as ActiveSessionState,
              startTime:    data.startTime?.toDate?.() ?? new Date(0),
              lastUpdated:  data.lastUpdated?.toDate?.() ?? new Date(0),
            };
          });
          setActiveSessions(sessions);
          setIsLoading(false);
        },
        (err) => {
          console.error('[useActiveUsers] Snapshot error:', err);
          if (unsub) { unsub(); unsub = null; }
          // Retry once after 2 s (handles transient auth token propagation delay)
          if (retryCount === 0) {
            retryCount++;
            retryTimerRef.current = setTimeout(() => {
              subscribe();
            }, 2000);
          } else {
            // Give up — show empty list rather than a broken state
            setActiveSessions([]);
            setIsLoading(false);
          }
        },
      );
    };

    subscribe();

    return () => {
      if (unsub) unsub();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  return { activeSessions, isLoading };
}
