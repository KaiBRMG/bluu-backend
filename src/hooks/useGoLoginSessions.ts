'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { auth } from '@/firebase-config';
import { getDeviceId } from '@/lib/deviceId';
import { sessionErrorMessage } from '@/app/gologin/_lib/session';
import type { GoLoginSession } from '@/types/electron';

/**
 * Every local GoLogin session this machine has, keyed by profile id.
 *
 * **Main is the source of truth** — it owns the SDK instances — so this reads a
 * snapshot on mount and then follows `gologin:session-changed` broadcasts. No
 * polling and no optimistic status: main sets `starting` and broadcasts it
 * before it begins any work, so the row updates on the click.
 */
export function useGoLoginSessions() {
  const [sessions, setSessions] = useState<Record<string, GoLoginSession>>({});
  const api = typeof window !== 'undefined' ? window.electronAPI?.gologin : undefined;
  const supported = !!api;

  useEffect(() => {
    if (!api) return;
    let alive = true;

    void api.listSessions().then((current) => {
      if (!alive || !current?.length) return;
      setSessions((prev) => {
        const next = { ...prev };
        for (const session of current) {
          if (session.profileId) next[session.profileId] = session;
        }
        return next;
      });
    });

    api.onSessionChanged((session) => {
      if (!alive || !session.profileId) return;
      setSessions((prev) => ({ ...prev, [session.profileId as string]: session }));
    });

    return () => {
      alive = false;
      // `removeAllListeners` on the channel. Safe because a renderer's listeners
      // are its own — the viewer window subscribes to the same channel in its
      // own process — but within ONE window there must never be two subscribers,
      // or this teardown rips out the other's handler.
      api.removeSessionChangedListeners();
    };
  }, [api]);

  const launch = useCallback(
    async (profileId: string, name?: string) => {
      // Named in every failure: several launches can be in flight, and "GoLogin
      // could not start this profile" does not say which one.
      const label = name ? `${name}: ` : '';
      if (!api) {
        toast.error(sessionErrorMessage('unsupported'));
        return false;
      }
      // Optimistic `starting`, set on the click rather than when main first
      // broadcasts. Until then the button still said Launch and took a second
      // click — which, on a list, can land on a different row.
      setSessions((prev) => ({
        ...prev,
        [profileId]: { ...prev[profileId], profileId, status: 'starting', error: null },
      }));
      const fail = (error: string | null | undefined) =>
        setSessions((prev) => ({ ...prev, [profileId]: { profileId, status: 'failed', error: error ?? null } }));

      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        fail('unauthenticated');
        toast.error(label + sessionErrorMessage('unauthenticated'));
        return false;
      }
      // The device id distinguishes the same person on two machines, which is
      // still a session conflict. Null when storage is blocked; main falls back
      // to an id of its own rather than refusing to launch.
      const result = await api.launch(idToken, profileId, getDeviceId());
      if (result?.session) {
        setSessions((prev) => ({ ...prev, [profileId]: result.session as GoLoginSession }));
      } else if (!result?.success) {
        fail(result?.error);
      }
      if (!result?.success) {
        // A launch is a slow, occasional action whose failure is otherwise only
        // a small badge on one row — this is exactly the mutation the toast rule
        // exists for. "Someone else has it" names them, because the operator's
        // next move is to go and ask that person.
        const holder = result?.holder?.displayName;
        toast.error(
          label +
            (result?.error === 'in-use' && holder
              ? `${holder} has this profile open.`
              : sessionErrorMessage(result?.error)),
        );
        return false;
      }
      return true;
    },
    [api],
  );

  const stop = useCallback(
    async (profileId: string) => {
      if (!api) return false;
      const result = await api.stop(profileId);
      if (!result?.success) {
        toast.error(sessionErrorMessage(result?.error));
        return false;
      }
      setSessions((prev) => {
        const next = { ...prev };
        delete next[profileId];
        return next;
      });
      return true;
    },
    [api],
  );

  return { sessions, supported, launch, stop };
}
