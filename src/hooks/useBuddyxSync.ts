'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, useAuthFetch } from '@/hooks/useAuthFetch';
import type { BuddyxScope } from '@/lib/buddyx/constants';
import { formatRelative } from '@/lib/salary/salaryFormat';

export interface ScopeFreshness {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

interface StatusResponse {
  configured: boolean;
  scopes: Record<BuddyxScope, ScopeFreshness>;
  running: string | null;
  salesWriteEnabled: boolean;
}

const POLL_MS = 5000;
const POLL_LIMIT_MS = 6 * 60_000;

/**
 * One status request per page, however many components ask: CA Admin → Sales
 * mounts this hook twice and the dispute dialog a third time, and concurrent
 * first fetches would each miss the browser cache and reach the origin.
 */
let inflight: Promise<StatusResponse | null> | null = null;

/**
 * Freshness of one BuddyX scope, and the refresh button behind `SyncStatus`.
 *
 * Reads `/api/buddyx/status` (three document reads, browser-cached 15s). A
 * refresh POSTs `/api/buddyx/sync` and handles the route's three non-run
 * answers in words: inside the cooldown → "Already up to date"; another sync
 * running → polls status until it clears; not configured → an error toast.
 * Whatever happens, `onSynced` runs only when there is new data to read, and
 * the page's existing figures stay on screen throughout — stale is not empty.
 */
export function useBuddyxSync(scope: BuddyxScope, onSynced?: () => void) {
  const authFetch = useAuthFetch();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const onSyncedRef = useRef(onSynced);
  useEffect(() => {
    onSyncedRef.current = onSynced;
  }, [onSynced]);

  const loadStatus = useCallback(
    async (fresh = false): Promise<StatusResponse | null> => {
      if (!inflight || fresh) {
        // A poll must see the change it is waiting for, not the 15s cached copy.
        inflight = (authFetch('/api/buddyx/status', { cache: fresh ? 'no-store' : 'default' }) as Promise<StatusResponse>)
          .catch(() => null)
          .finally(() => setTimeout(() => (inflight = null), 0));
      }
      const body = await inflight;
      if (body) setStatus(body);
      return body;
    },
    [authFetch],
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const waitForIdle = useCallback(async () => {
    const started = Date.now();
    while (Date.now() - started < POLL_LIMIT_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
      const next = await loadStatus(true);
      if (next && !next.running) return true;
    }
    return false;
  }, [loadStatus]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const body = (await authFetch('/api/buddyx/sync', { method: 'POST', body: JSON.stringify({ scope }) })) as {
        fresh?: boolean;
        syncedAt?: string | null;
      };
      if (body.fresh) {
        toast.success(`Already up to date — synced ${formatRelative(body.syncedAt ?? null)}`);
        return;
      }
      await loadStatus(true);
      onSyncedRef.current?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone else's sync holds the lease. Wait for it, then read.
        if (await waitForIdle()) onSyncedRef.current?.();
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Sync failed');
      await loadStatus(true);
    } finally {
      setRefreshing(false);
    }
  }, [authFetch, refreshing, scope, waitForIdle, loadStatus]);

  return {
    freshness: status?.scopes[scope] ?? null,
    configured: status?.configured ?? true,
    salesWriteEnabled: status?.salesWriteEnabled ?? false,
    /** True while a sync (ours or anyone's) is running. */
    syncing: refreshing || Boolean(status?.running),
    refresh,
    reloadStatus: () => loadStatus(true),
  };
}

/** The creators a BuddyX model is mapped to — the dispute dialog's picker. `null` while loading. */
export function useBuddyxCreators(): string[] | null {
  const authFetch = useAuthFetch();
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    authFetch('/api/buddyx/creators')
      .then((body: { creatorIds: string[] }) => setIds(body.creatorIds))
      .catch(() => setIds(null));
  }, [authFetch]);
  return ids;
}
