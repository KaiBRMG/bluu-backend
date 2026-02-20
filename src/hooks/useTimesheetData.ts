'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import type { TimeEntryState } from '@/types/firestore';

export interface TimesheetEntry {
  id: string;
  state: TimeEntryState;
  createdTime: string;
  lastTime: string;
}

interface UseTimesheetDataReturn {
  entries: TimesheetEntry[];
  timezone: string;
  includeIdleTime: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTimesheetData(
  userId: string | null,
  startDate: string | null,
  endDate: string | null,
): UseTimesheetDataReturn {
  const { user } = useAuth();
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [timezone, setTimezone] = useState('UTC');
  const [includeIdleTime, setIncludeIdleTime] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!user || !startDate || !endDate) return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ startDate, endDate });
      if (userId) params.set('userId', userId);

      const res = await fetch(`/api/time-tracking/entries?${params}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      const data = await res.json();
      setEntries(data.entries);
      setTimezone(data.timezone || 'UTC');
      setIncludeIdleTime(data.includeIdleTime ?? false);
    } catch (err) {
      console.error('[useTimesheetData] Fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [user, userId, startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { entries, timezone, includeIdleTime, loading, error, refetch: fetchData };
}
