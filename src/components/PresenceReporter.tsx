'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';

/**
 * Records that the app is open, so the Employee Registry can show a real
 * "last seen" instead of a sign-in date.
 *
 * ## Why a separate signal
 *
 * `lastLoginAt` is written once, at sign-in. The Electron shell never reloads
 * itself and staff do not quit it (rule 9c), so for most of the fleet that
 * value is months old and answers a question nobody asked. "Is this person
 * still using the app?" needs something written while the app is *running*.
 *
 * `active_sessions` cannot answer it either: that doc exists only while the
 * user is clocked in and is deleted at clock-out, and the time-tracking
 * heartbeat only runs in the `working` state. Being clocked out is not being
 * away — the app is still open.
 *
 * ## What counts as online
 *
 * Having the app open **in any capacity**. So:
 *
 *  • Every authenticated window mounts this — the main window's `(main)` layout
 *    and both satellites (`/of-manager`, `/gologin`). Duplicate pings from a
 *    user running more than one are collapsed server-side.
 *  • It does **not** gate on `document.visibilityState`. A minimised or
 *    backgrounded window is still the app being open, and `backgroundThrottling`
 *    is off on every Electron window, so the interval keeps its cadence there.
 *    The one case that genuinely stops counting is a sleeping machine, which
 *    handles itself: timers do not fire, so no ping is sent.
 *  • Focus, visibility and `online` are extra triggers rather than the
 *    mechanism — they are what makes the first stamp after a wake or a
 *    reconnect land promptly instead of up to an interval late.
 *
 * ## Cost (rule 9)
 *
 * The interval is slow and the client throttles itself, because the display is
 * "seen today / 3d ago" — ten-minute resolution is already far finer than
 * anything that renders it. A failed ping is dropped rather than retried; the
 * next one is along shortly, and there is nothing to reconcile. See
 * `/api/user/presence` for the server-side half.
 */

/** How often an open window stamps presence. */
const PRESENCE_INTERVAL_MS = 10 * 60 * 1000;

/** Floor between pings, so a burst of focus/visibility events sends one. */
const MIN_PING_GAP_MS = 9 * 60 * 1000;

export default function PresenceReporter() {
  const { user } = useAuth();

  const lastPingRef = useRef(0);
  const inFlightRef = useRef(false);

  // Read live inside handlers that are registered once per session.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const ping = useCallback(async (force = false) => {
    const current = userRef.current;
    if (!current || inFlightRef.current) return;

    const now = Date.now();
    if (!force && now - lastPingRef.current < MIN_PING_GAP_MS) return;

    inFlightRef.current = true;
    // Stamped before the request, not after: a request that hangs must not let
    // every later trigger queue another one behind it.
    lastPingRef.current = now;
    try {
      const idToken = await current.getIdToken();
      await fetch('/api/user/presence', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store',
      });
    } catch {
      // Offline, or mid-deploy. Nothing to recover — the next trigger tries
      // again, and a missed stamp only costs resolution on a value measured in
      // days.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    // The first stamp is forced past the gap check: a fresh mount is a fresh
    // window, and this is the ping that makes "seen today" true on the day a
    // user actually opens the app.
    void ping(true);

    const onTrigger = () => { void ping(); };
    window.addEventListener('focus', onTrigger);
    window.addEventListener('online', onTrigger);
    document.addEventListener('visibilitychange', onTrigger);
    const interval = setInterval(onTrigger, PRESENCE_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', onTrigger);
      window.removeEventListener('online', onTrigger);
      document.removeEventListener('visibilitychange', onTrigger);
      clearInterval(interval);
    };
  }, [user, ping]);

  return null;
}
