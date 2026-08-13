'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { extractAccountHandle } from '@/lib/smm/linkUtils';

const DEBOUNCE_MS = 400;

export interface SmmAccountResolution {
  exists: boolean;
  /** The name as stored — casing included, so the copy can quote it. */
  accountName?: string;
  active?: boolean;
  /** Assigned to the caller. Never the uid — the route doesn't return one. */
  mine?: boolean;
}

/**
 * "Is this handle an account at all, and whose?" — the diagnostic behind a
 * failed account match in the schedule dialog, which only ever holds the
 * caller's own accounts and so cannot tell "no such account" from "not yours".
 *
 * Same three brakes as {@link useSmmPostLinkCheck}: callers pass `enabled:
 * false` until the local match has actually failed, the link is debounced, and
 * a module-level cache keyed by the lower-cased handle makes re-typing free.
 * A late answer for a link the user has moved on from is discarded (`latest`).
 *
 * Purely for the error copy — a failure resolves to `null`, and the caller
 * shows its generic message rather than blocking on the lookup.
 */
const cache = new Map<string, SmmAccountResolution>();

export function useSmmAccountResolve(
  link: string,
  { enabled = true }: { enabled?: boolean } = {},
): { checking: boolean; resolution: SmmAccountResolution | null } {
  const authFetch = useAuthFetch();
  const debouncedLink = useDebouncedValue(link, DEBOUNCE_MS);

  const [checking, setChecking] = useState(false);
  const [resolution, setResolution] = useState<SmmAccountResolution | null>(null);
  const latest = useRef(0);

  const handle = enabled ? extractAccountHandle(debouncedLink).toLowerCase() : '';

  useEffect(() => {
    const seq = ++latest.current;

    if (!handle) {
      setChecking(false);
      setResolution(null);
      return;
    }
    const cached = cache.get(handle);
    if (cached !== undefined) {
      setChecking(false);
      setResolution(cached);
      return;
    }

    setChecking(true);
    // The route re-extracts the handle, so the raw link is what goes over.
    authFetch(`/api/smm/accounts/resolve?link=${encodeURIComponent(debouncedLink.trim())}`)
      .then((data: SmmAccountResolution) => {
        cache.set(handle, data);
        if (seq === latest.current) setResolution(data);
      })
      .catch(() => { if (seq === latest.current) setResolution(null); })
      .finally(() => { if (seq === latest.current) setChecking(false); });
    // `debouncedLink` is intentionally not a dependency: `handle` already
    // captures every change that can alter the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, authFetch]);

  return { checking, resolution };
}

/** Drop cached resolutions — call after accounts are assigned/edited. */
export function invalidateAccountResolve(): void {
  cache.clear();
}
