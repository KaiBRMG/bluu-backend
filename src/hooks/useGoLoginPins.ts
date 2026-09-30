'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useUserData } from '@/hooks/useUserData';

/**
 * The GoLogin window's **Pinned** folder — Bluu's own, per person, stored on
 * `users/{uid}.gologinPinnedProfileIds` and read off the live `useUserData()`
 * snapshot the window already holds. Same shape as `usePinnedGrowthAccounts`,
 * for the same two reasons:
 *
 *  - The snapshot array is **content-compared**. Presence and time tracking
 *    rewrite the user doc every few minutes, each time handing down a new array
 *    with the same ids; keyed on the array, every profile row re-rendered.
 *  - The optimistic value is **tagged with the snapshot it was made against**,
 *    so once the write echoes back the tag no longer matches and the server list
 *    takes over — nothing to clear, no effect. `togglePin` reads through a ref,
 *    so its identity never changes.
 *
 * No success toast: the pin mark flipping in place is the confirmation (the
 * high-frequency exception, DESIGN.md §5). Failures toast.
 */
export function useGoLoginPins() {
  const authFetch = useAuthFetch();
  const { userData } = useUserData();

  const serverKey = (userData?.gologinPinnedProfileIds ?? []).join(',');
  const server = useMemo(() => new Set(serverKey ? serverKey.split(',') : []), [serverKey]);

  const [optimistic, setOptimistic] = useState<{ base: string; value: Set<string> } | null>(null);
  const pinned = optimistic && optimistic.base === serverKey ? optimistic.value : server;

  const current = useRef({ pinned, serverKey });
  useLayoutEffect(() => {
    current.current = { pinned, serverKey };
  });

  const togglePin = useCallback(
    async (profileId: string) => {
      const { pinned: set, serverKey: base } = current.current;
      const on = !set.has(profileId);
      const next = new Set(set);
      if (on) next.add(profileId);
      else next.delete(profileId);
      setOptimistic({ base, value: next });
      try {
        await authFetch('/api/gologin/pins', {
          method: 'POST',
          body: JSON.stringify({ profileId, pinned: on }),
        });
      } catch (err) {
        setOptimistic(null); // back to the server's list
        toast.error(err instanceof Error ? err.message : 'Could not change that pin.');
      }
    },
    [authFetch],
  );

  return { pinned: pinned as ReadonlySet<string>, togglePin };
}
