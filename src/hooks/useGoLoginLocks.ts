'use client';

import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuth } from '@/components/AuthProvider';

export interface GoLoginLock {
  profileId: string;
  uid: string;
  displayName: string;
  heartbeatAtMs: number;
}

/** Must match STALE_AFTER_MS in lib/services/gologinLockService.ts. */
const STALE_AFTER_MS = 3 * 60_000;

/**
 * Who currently has which profile open, live, across every machine.
 *
 * **This is a Firestore listener rather than a GoLogin poll, and that is not a
 * preference.** GoLogin reports an `isRunning` flag on each profile, but seeing
 * it change would mean polling the provider — and a 429 there revokes the API
 * token permanently (CLAUDE.md rule 9e). So the lock the app already writes at
 * launch doubles as the display: one listener over a collection that holds only
 * *active* sessions, so it is a handful of documents even for a large workspace.
 *
 * Claims are dropped by the teardown that closes the browser. A machine that
 * loses power cannot do that, so a claim whose heartbeat has gone quiet is
 * filtered out here too — the same window the server uses when deciding whether
 * a claim can be taken over, so the two never disagree about what is live.
 */
/** Drop claims whose heartbeat has gone quiet. Never called during render. */
function pruneStale(all: Record<string, GoLoginLock>): Record<string, GoLoginLock> {
  const now = Date.now();
  const live: Record<string, GoLoginLock> = {};
  for (const [profileId, lock] of Object.entries(all)) {
    if (now - lock.heartbeatAtMs < STALE_AFTER_MS) live[profileId] = lock;
  }
  return live;
}

export function useGoLoginLocks() {
  const { user } = useAuth();
  // Two copies on purpose: `raw` is whatever Firestore last said, `locks` is the
  // subset still inside the stale window. The pruning reads the clock, which
  // makes it impure — so it happens in the snapshot handler and on a timer,
  // never during render (`react-hooks/purity`).
  const rawRef = useRef<Record<string, GoLoginLock>>({});
  const [locks, setLocks] = useState<Record<string, GoLoginLock>>({});

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      collection(db, 'gologin-sessions'),
      (snap) => {
        const next: Record<string, GoLoginLock> = {};
        snap.forEach((docSnap) => {
          const data = docSnap.data() as Partial<GoLoginLock>;
          next[docSnap.id] = {
            profileId: docSnap.id,
            uid: data.uid ?? '',
            displayName: data.displayName ?? 'Another user',
            heartbeatAtMs: data.heartbeatAtMs ?? 0,
          };
        });
        rawRef.current = next;
        setLocks(pruneStale(next));
      },
      (error) => {
        // Not fatal: without this the rows simply cannot say who holds a
        // profile. The server still refuses the launch, which is the part that
        // actually prevents the collision.
        console.error('[gologin] session lock listener failed:', error);
      },
    );
    return () => unsubscribe();
  }, [user]);

  // A claim that expires while nothing else changes produces no snapshot, so
  // without this tick a dead holder would keep a row blocked until the next
  // write anywhere in the collection.
  useEffect(() => {
    const timer = setInterval(() => setLocks(pruneStale(rawRef.current)), 30_000);
    return () => clearInterval(timer);
  }, []);

  return { locks };
}
