'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { detectDeviceTimezone } from '@/lib/timezone';

/**
 * Keeps `users/{uid}.timezone` in step with where the user actually is.
 *
 * The zone itself is worked out **server-side, from the IP** — see
 * `/api/user/timezone`. This component is only the trigger, plus the device's
 * own `Intl` zone as a fallback for the platform header (which does not exist
 * in local dev).
 *
 * ## Why it pings rather than running once at sign-in
 *
 * The Electron shell never reloads and staff do not quit it (rule 9c), so a
 * sign-in hook would reach most of the fleet roughly never. The slow interval
 * is what makes a relocation — or a DST change, which moves the stored offset
 * label — land within a working day instead of at the next login months later.
 *
 * ## Cost (rules 9 and 9i)
 *
 * It stops calling entirely once the user has chosen a timezone by hand, and
 * the route writes only on a real change, so the steady state for the whole
 * fleet is one cached Firestore read per user per six hours and no writes. A
 * failed ping is dropped rather than retried — the next trigger is along
 * shortly and there is nothing to reconcile.
 */

/** How often an open window re-checks. Long: this answers "have you moved?". */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Floor between pings, so a burst of focus/online events sends one. */
const MIN_PING_GAP_MS = 60 * 60 * 1000;

export default function TimezoneReporter() {
  const { user } = useAuth();
  const { userData } = useUserData();

  const lastPingRef = useRef(0);
  const inFlightRef = useRef(false);

  // Read live inside handlers that are registered once per session.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  // A manual choice in App Settings is final — see the route's header. Held in
  // a ref so switching to manual silences the interval already running, without
  // tearing the listeners down and re-arming them.
  const isManualRef = useRef(false);
  useEffect(() => { isManualRef.current = userData?.timezoneSource === 'manual'; }, [userData?.timezoneSource]);

  const ping = useCallback(async (force = false) => {
    const current = userRef.current;
    if (!current || inFlightRef.current || isManualRef.current) return;

    const now = Date.now();
    if (!force && now - lastPingRef.current < MIN_PING_GAP_MS) return;

    inFlightRef.current = true;
    // Stamped before the request, not after: a request that hangs must not let
    // every later trigger queue another one behind it.
    lastPingRef.current = now;
    try {
      const idToken = await current.getIdToken();
      await fetch('/api/user/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ deviceTimezone: detectDeviceTimezone() }),
        cache: 'no-store',
      });
      // Nothing to apply here: the write lands on `users/{uid}`, which the app
      // already streams through `useUserData`.
    } catch {
      // Offline, or mid-deploy. The next trigger tries again.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    // Forced past the gap check: a fresh mount is a fresh window, and for a
    // user with no timezone at all this is the ping that stops the whole app
    // rendering their times in UTC.
    void ping(true);

    const onTrigger = () => { void ping(); };
    window.addEventListener('focus', onTrigger);
    window.addEventListener('online', onTrigger);
    const interval = setInterval(onTrigger, CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', onTrigger);
      window.removeEventListener('online', onTrigger);
      clearInterval(interval);
    };
  }, [user, ping]);

  return null;
}
