'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';

export const MAX_PINNED_RESOURCES = 10;

interface UsePinnedResourcesResult {
  /** Notion document IDs the user has pinned (optimistically updated). */
  pinned: string[];
  isPinned: (id: string) => boolean;
  /** Pin/unpin a resource by document id. Enforces the 10-item cap with a toast. */
  togglePin: (id: string) => Promise<void>;
  max: number;
}

/**
 * Reads the user's pinned Notion resources from the live user-doc snapshot and
 * exposes an optimistic toggle that persists via `/api/user/update`. The 10-item
 * cap is enforced here (and again server-side) — attempting to exceed it shows a
 * toast and is a no-op.
 */
export function usePinnedResources(): UsePinnedResourcesResult {
  const { user } = useAuth();
  const { userData } = useUserData();
  const serverPinned = userData?.pinnedResources;

  const [pinned, setPinned] = useState<string[]>(serverPinned ?? []);

  // Keep local state in sync with the Firestore snapshot. Optimistic updates set
  // local state ahead of the snapshot; once it lands this re-syncs to the same value.
  useEffect(() => {
    setPinned(serverPinned ?? []);
  }, [serverPinned]);

  const isPinned = useCallback((id: string) => pinned.includes(id), [pinned]);

  const togglePin = useCallback(
    async (id: string) => {
      const currentlyPinned = pinned.includes(id);

      if (!currentlyPinned && pinned.length >= MAX_PINNED_RESOURCES) {
        toast.error(
          `You can pin up to ${MAX_PINNED_RESOURCES} resources. Unpin one to add another.`
        );
        return;
      }

      const previous = pinned;
      const next = currentlyPinned
        ? pinned.filter(p => p !== id)
        : [...pinned, id];

      setPinned(next); // optimistic

      try {
        const idToken = user ? await user.getIdToken() : null;
        if (!idToken) throw new Error('Not authenticated');

        const res = await fetch('/api/user/update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ pinnedResources: next }),
        });
        if (!res.ok) throw new Error('Request failed');
      } catch {
        setPinned(previous); // revert on failure
        toast.error('Could not update pinned resources. Please try again.');
      }
    },
    [pinned, user]
  );

  return { pinned, isPinned, togglePin, max: MAX_PINNED_RESOURCES };
}
