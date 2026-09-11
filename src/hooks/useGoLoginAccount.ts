'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';

/** The safe half of an account row. The API token is never sent back, not even masked. */
export interface GoLoginAccountSummary {
  /** True once they have pasted a working API token. */
  linked: boolean;
  /**
   * True once an admin has granted them a **paid workspace seat**. This gates
   * everything, onboarding included: a free GoLogin account cannot generate an
   * API token at all, so walking a non-member through fetching one would send
   * them after something that does not exist for them.
   */
  member: boolean;
  /** False while GoLogin's invitation email is still unaccepted. */
  joined: boolean;
  glEmail: string;
  folderName: string;
  planName: string;
  linkedAtMs: number | null;
}

const EMPTY: GoLoginAccountSummary = {
  linked: false,
  member: false,
  joined: false,
  glEmail: '',
  folderName: '',
  planName: '',
  linkedAtMs: null,
};

/**
 * The operator's own GoLogin state — seat, token, folder.
 *
 * Seeded from the user document (`gologinEmail` + `gologinLinkedAt`, already on
 * the `useUserData` snapshot) so the common case renders with no round trip at
 * all; the fetch that follows confirms live membership. Without the seed every
 * operator would watch a spinner on every open of the window.
 *
 * **The seed is optimistic about membership and the fetch is authoritative.**
 * `gologinEmail` says an admin granted a seat at some point; only the server can
 * say whether GoLogin still lists them, because a seat can be revoked in
 * GoLogin's own dashboard without anything telling us.
 */
export function useGoLoginAccount(seed?: { email?: string; linkedAt?: unknown }) {
  const authFetch = useAuthFetch();
  const seedEmail = seed?.email;
  const [account, setAccount] = useState<GoLoginAccountSummary>(() =>
    seedEmail
      ? { ...EMPTY, member: true, glEmail: seedEmail, linked: !!seed?.linkedAt }
      : EMPTY,
  );
  // Only the very first load is "unknown"; a later refresh must not send the
  // window back to a skeleton it has already moved past.
  const [loading, setLoading] = useState(!seedEmail);
  const [error, setError] = useState<string | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const data: GoLoginAccountSummary = await authFetch('/api/gologin/account');
      if (!aliveRef.current) return;
      setAccount(data ?? EMPTY);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not read your GoLogin account.');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Submit an API key. Returns an error message, or null on success.
   *
   * The key goes straight into the request body and is never held in this hook —
   * the form clears its own field on success and there is nowhere else for it to
   * linger.
   */
  const link = useCallback(
    async (apiKey: string): Promise<string | null> => {
      try {
        const data: GoLoginAccountSummary = await authFetch('/api/gologin/account', {
          method: 'POST',
          body: JSON.stringify({ apiKey }),
        });
        if (aliveRef.current) setAccount(data);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Could not link your GoLogin account.';
      }
    },
    [authFetch],
  );

  const unlink = useCallback(async () => {
    await authFetch('/api/gologin/account', { method: 'DELETE' });
    if (aliveRef.current) setAccount(EMPTY);
  }, [authFetch]);

  return { account, loading, error, link, unlink, reload: load };
}
