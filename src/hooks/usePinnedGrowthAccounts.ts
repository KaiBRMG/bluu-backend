'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useUserData } from '@/hooks/useUserData';
import { MAX_PINNED_GROWTH_ACCOUNTS } from '@/lib/growth/access';

interface UsePinnedGrowthAccountsResult {
  /** `growth-accounts` ids the user has pinned, in pin order (optimistically updated). */
  pinned: string[];
  isPinned: (id: string) => boolean;
  /** Pin or unpin an account. Enforces the cap with a toast. Stable identity. */
  togglePin: (id: string, handle: string) => Promise<void>;
  /** Remove pins for accounts that no longer exist. Stable identity. */
  prune: (existingIds: ReadonlySet<string>) => Promise<void>;
  max: number;
}

/**
 * The accounts pinned to the Growth Tracking home widget.
 *
 * Stored on the user document (`pinnedGrowthAccounts`) and read from the live
 * `useUserData()` snapshot every page already holds — so pinning costs one write
 * and reading costs nothing. The page owns the one instance; the account cards
 * and the panel get its state as props, so there is never a second optimistic
 * copy of the list to disagree with the first.
 *
 * Two things keep it cheap to re-render around:
 *  - The server list is **content-compared**. Presence and time tracking rewrite
 *    the user doc every few minutes, and each write hands down a new array with
 *    the same ids; keyed on the array, every card on the grid re-rendered.
 *  - `togglePin` and `prune` read the list through a ref, so their identity never
 *    changes — a star click re-renders the one card whose `pinned` flipped.
 *
 * The cap is checked here for the toast and again server-side, where it is
 * actually enforced (rule 10).
 */
export function usePinnedGrowthAccounts(): UsePinnedGrowthAccountsResult {
  const authFetch = useAuthFetch();
  const { userData } = useUserData();

  const serverKey = (userData?.pinnedGrowthAccounts ?? []).join(',');
  const server = useMemo(() => (serverKey ? serverKey.split(',') : []), [serverKey]);

  // An optimistic write, tagged with the server list it was made against. Once
  // the snapshot moves on (the write landed) the tag no longer matches and the
  // server list — now containing the write — takes over; no effect needed.
  const [optimistic, setOptimistic] = useState<{ base: string; value: string[] } | null>(null);
  const pinned = optimistic && optimistic.base === serverKey ? optimistic.value : server;

  const current = useRef({ pinned, serverKey });
  useLayoutEffect(() => { current.current = { pinned, serverKey }; });

  const write = useCallback(async (next: string[]) => {
    await authFetch('/api/user/update', {
      method: 'POST',
      body: JSON.stringify({ pinnedGrowthAccounts: next }),
    });
  }, [authFetch]);

  const isPinned = useCallback((id: string) => pinned.includes(id), [pinned]);

  const togglePin = useCallback(async (id: string, handle: string) => {
    const { pinned: list, serverKey: base } = current.current;
    const wasPinned = list.includes(id);

    if (!wasPinned && list.length >= MAX_PINNED_GROWTH_ACCOUNTS) {
      toast.error(`You can pin up to ${MAX_PINNED_GROWTH_ACCOUNTS} accounts. Unpin one to add @${handle}.`);
      return;
    }

    const next = wasPinned ? list.filter((p) => p !== id) : [...list, id];
    setOptimistic({ base, value: next });
    try {
      await write(next);
      toast.success(wasPinned
        ? `Unpinned @${handle} from your home page`
        : `Pinned @${handle} to your home page`);
    } catch {
      setOptimistic(null); // back to the server's list
      toast.error('Could not update your pinned accounts. Please try again.');
    }
  }, [write]);

  /**
   * Drop pins whose account no longer exists. A deleted account renders nowhere,
   * so its pin could never be clicked off again and would hold one of the five
   * slots forever. Silent — it tidies something the user cannot see — and one
   * write, made only when there is something to remove.
   */
  const prune = useCallback(async (existingIds: ReadonlySet<string>) => {
    const { pinned: list, serverKey: base } = current.current;
    const next = list.filter((id) => existingIds.has(id));
    if (next.length === list.length) return;
    setOptimistic({ base, value: next });
    try {
      await write(next);
    } catch {
      setOptimistic(null); // harmless: the next visit tries again
    }
  }, [write]);

  return { pinned, isPinned, togglePin, prune, max: MAX_PINNED_GROWTH_ACCOUNTS };
}
