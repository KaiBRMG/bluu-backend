'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';

export interface ScreenshotScreen {
  id: string;
  timestampUTC: string;
  url: string;
  thumbnailUrl: string;
  screenIndex: number;
}

export interface ScreenshotGroup {
  captureGroup: string;
  timestampUTC: string;
  screenCount: number;
  screens: ScreenshotScreen[];
}

interface UseAdminScreenshotsReturn {
  groups: ScreenshotGroup[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAdminScreenshots(
  userId: string | null,
  date: string | null,
): UseAdminScreenshotsReturn {
  const { user } = useAuth();
  const [groups, setGroups] = useState<ScreenshotGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!user || !userId || !date) {
      setGroups([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ userId, date });

      const res = await fetch(`/api/time-tracking/screenshots?${params}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      const data = await res.json();
      setGroups(data.groups || []);
    } catch (err) {
      console.error('[useAdminScreenshots] Fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [user, userId, date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { groups, loading, error, refetch: fetchData };
}
