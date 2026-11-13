'use client';

import { useEffect, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { DataFreshness, type FreshnessStatus } from './DataFreshness';

/**
 * One status request per page, however many headers ask (CA Admin → Sales and
 * the dispute dialog can mount together); concurrent first fetches would each
 * miss the browser cache and reach the origin.
 */
let inflight: Promise<FreshnessStatus | null> | null = null;

/**
 * `DataFreshness` for a page header: reads `/api/onlymonster/status` and shows
 * when the data on screen was synced. Passive by design — there is no refresh
 * button (D10). A failed read renders nothing rather than a false claim.
 */
export function SyncFreshness({ className }: { className?: string }) {
  const authFetch = useAuthFetch();
  const { timezone } = useViewerTimezone();
  const [status, setStatus] = useState<FreshnessStatus | null>(null);

  useEffect(() => {
    let live = true;
    if (!inflight) {
      inflight = (authFetch('/api/onlymonster/status') as Promise<FreshnessStatus>)
        .catch(() => null)
        .finally(() => setTimeout(() => (inflight = null), 0));
    }
    void inflight.then(body => {
      if (live && body) setStatus(body);
    });
    return () => {
      live = false;
    };
  }, [authFetch]);

  return <DataFreshness status={status} timezone={timezone} className={className} />;
}
