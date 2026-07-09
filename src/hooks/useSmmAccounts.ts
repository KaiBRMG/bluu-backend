'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, invalidateCacheByPrefix, setCache } from '@/lib/queryCache';
import type { SmmAccount } from '@/types/firestore';

export type SmmAccountScope = 'mine' | 'active' | 'all';

export interface SmmAccountPayload {
  accountName: string;
  accountLink: string;
  type: string[];
  network: string;
  tier: number;
  assigned: string | null;
  driveLink?: string;
  comments?: string;
  information?: string;
  status?: string;
}

const CACHE_PREFIX = 'bluu_smm_accounts_';
const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheKey = (scope: SmmAccountScope) => `${CACHE_PREFIX}${scope}_v1`;

/**
 * twitterx-accounts, cached in sessionStorage per scope (5-min TTL).
 * 'active' returns slim {id, accountName} docs — typed as SmmAccount for
 * convenience, but only those two fields are populated.
 */
export function useSmmAccounts(scope: SmmAccountScope) {
  const { user } = useAuth();
  const authFetch = useAuthFetch();

  const [accounts, setAccounts] = useState<SmmAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = getCache<SmmAccount[]>(cacheKey(scope), CACHE_TTL_MS);
      if (cached) {
        setAccounts(cached);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const data = await authFetch(`/api/smm/accounts?scope=${scope}`);
      setAccounts(data.accounts);
      setCache(cacheKey(scope), data.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch accounts');
    } finally {
      setLoading(false);
    }
  }, [authFetch, scope]);

  useEffect(() => {
    if (!user) return;
    fetchAccounts();
  }, [user, fetchAccounts]);

  // Mutations invalidate every scope's cache — an edit in the admin database
  // must be visible on the dashboard kanban after its next fetch.
  const invalidateAndRefetch = useCallback(async () => {
    invalidateCacheByPrefix(CACHE_PREFIX);
    await fetchAccounts(true);
  }, [fetchAccounts]);

  const createAccount = useCallback(async (payload: SmmAccountPayload) => {
    await authFetch('/api/smm/accounts', { method: 'POST', body: JSON.stringify(payload) });
    await invalidateAndRefetch();
  }, [authFetch, invalidateAndRefetch]);

  const updateAccount = useCallback(async (id: string, updates: Partial<SmmAccountPayload>) => {
    await authFetch(`/api/smm/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
    await invalidateAndRefetch();
  }, [authFetch, invalidateAndRefetch]);

  const deleteAccount = useCallback(async (id: string) => {
    await authFetch(`/api/smm/accounts/${id}`, { method: 'DELETE' });
    await invalidateAndRefetch();
  }, [authFetch, invalidateAndRefetch]);

  return useMemo(() => ({
    accounts,
    loading,
    error,
    refresh: invalidateAndRefetch,
    createAccount,
    updateAccount,
    deleteAccount,
  }), [accounts, loading, error, invalidateAndRefetch, createAccount, updateAccount, deleteAccount]);
}

// ─── Admin database: lazy per-network loading ────────────────────────────

/** One network group's fetch state. */
export interface NetworkGroupState {
  accounts: SmmAccount[];
  loading: boolean;
  loaded: boolean;
}

const NETWORK_CACHE_PREFIX = 'bluu_smm_accounts_net_'; // still under CACHE_PREFIX
const networkCacheKey = (network: string) => `${NETWORK_CACHE_PREFIX}${network}_v1`;

const emptyGroup: NetworkGroupState = { accounts: [], loading: false, loaded: false };

/**
 * The admin Account Database, loaded one network group at a time. The full
 * `twitterx-accounts` collection is large, so nothing is fetched until a group
 * is expanded — `loadNetwork(network)` fetches (and caches) just that network's
 * accounts. Mutations invalidate every accounts cache (including the dashboard
 * `mine`/`active` scopes) and refetch only the currently-loaded groups.
 */
export function useSmmAccountDatabase() {
  const authFetch = useAuthFetch();
  const [groups, setGroups] = useState<Record<string, NetworkGroupState>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const loadNetwork = useCallback(async (network: string, forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = getCache<SmmAccount[]>(networkCacheKey(network), CACHE_TTL_MS);
      if (cached) {
        setGroups((prev) => ({ ...prev, [network]: { accounts: cached, loading: false, loaded: true } }));
        return;
      }
      if (inFlight.current.has(network)) return; // a fetch is already running
    }
    inFlight.current.add(network);
    setGroups((prev) => ({
      ...prev,
      [network]: { accounts: prev[network]?.accounts ?? [], loading: true, loaded: prev[network]?.loaded ?? false },
    }));
    try {
      const data = await authFetch(`/api/smm/accounts?scope=all&network=${encodeURIComponent(network)}`);
      setGroups((prev) => ({ ...prev, [network]: { accounts: data.accounts, loading: false, loaded: true } }));
      setCache(networkCacheKey(network), data.accounts);
    } catch {
      setGroups((prev) => ({
        ...prev,
        [network]: { accounts: prev[network]?.accounts ?? [], loading: false, loaded: prev[network]?.loaded ?? false },
      }));
    } finally {
      inFlight.current.delete(network);
    }
  }, [authFetch]);

  // A mutation can create/move/remove an account in any network, so drop every
  // accounts cache and refetch the groups the user currently has open.
  const invalidateAndRefetch = useCallback(async () => {
    invalidateCacheByPrefix(CACHE_PREFIX);
    const loaded = Object.entries(groups)
      .filter(([, g]) => g.loaded || g.loading)
      .map(([network]) => network);
    await Promise.all(loaded.map((network) => loadNetwork(network, true)));
  }, [groups, loadNetwork]);

  const createAccount = useCallback(async (payload: SmmAccountPayload) => {
    await authFetch('/api/smm/accounts', { method: 'POST', body: JSON.stringify(payload) });
    await invalidateAndRefetch();
  }, [authFetch, invalidateAndRefetch]);

  const updateAccount = useCallback(async (id: string, updates: Partial<SmmAccountPayload>) => {
    await authFetch(`/api/smm/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
    await invalidateAndRefetch();
  }, [authFetch, invalidateAndRefetch]);

  /**
   * Commit a batch of staged inline edits — one PATCH per account, then a single
   * cache invalidation + refetch (keeps Firestore writes minimal and avoids
   * refetching once per edited account).
   */
  const saveAccounts = useCallback(async (edits: Record<string, Partial<SmmAccountPayload>>) => {
    const entries = Object.entries(edits).filter(([, u]) => Object.keys(u).length > 0);
    if (entries.length === 0) return;
    await Promise.all(entries.map(([id, updates]) =>
      authFetch(`/api/smm/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
    ));
    await invalidateAndRefetch();
  }, [authFetch, invalidateAndRefetch]);

  const deleteAccount = useCallback(async (id: string) => {
    await authFetch(`/api/smm/accounts/${id}`, { method: 'DELETE' });
    await invalidateAndRefetch();
  }, [authFetch, invalidateAndRefetch]);

  const groupFor = useCallback((network: string) => groups[network] ?? emptyGroup, [groups]);

  return useMemo(() => ({
    groupFor,
    loadNetwork,
    createAccount,
    updateAccount,
    saveAccounts,
    deleteAccount,
  }), [groupFor, loadNetwork, createAccount, updateAccount, saveAccounts, deleteAccount]);
}
