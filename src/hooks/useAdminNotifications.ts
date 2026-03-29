'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import type { AdminNotificationBatch, NotificationType } from '@/types/firestore';

export type { AdminNotificationBatch };

interface AdminNotificationsState {
  batches: AdminNotificationBatch[];
  loading: boolean;
  error: string | null;
}

export interface CreateBatchPayload {
  title: string;
  message: string;
  type: NotificationType;
  userIds: string[];
  groupIds: string[];
  actionUrl?: string | null;
}

const CACHE_KEY = 'bluu_admin_notifications_v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function useAdminNotifications() {
  const { user } = useAuth();
  const [state, setState] = useState<AdminNotificationsState>(() => {
    const cached = getCache<AdminNotificationBatch[]>(CACHE_KEY, CACHE_TTL_MS);
    if (cached) return { batches: cached, loading: false, error: null };
    return { batches: [], loading: true, error: null };
  });

  const fetchBatches = useCallback(
    async (forceRefresh = false) => {
      if (!user) return;

      if (!forceRefresh) {
        const cached = getCache<AdminNotificationBatch[]>(CACHE_KEY, CACHE_TTL_MS);
        if (cached) {
          setState({ batches: cached, loading: false, error: null });
          return;
        }
      }

      try {
        setState(prev => ({ ...prev, loading: true, error: null }));
        const idToken = await user.getIdToken();

        const res = await fetch('/api/admin/notifications', {
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (!res.ok) {
          if (res.status === 403) throw new Error('Access denied');
          throw new Error(`Failed to fetch notifications: ${res.status}`);
        }

        const data = await res.json();
        const batches: AdminNotificationBatch[] = data.batches ?? [];
        setCache<AdminNotificationBatch[]>(CACHE_KEY, batches);
        setState({ batches, loading: false, error: null });
      } catch (err) {
        console.error('Error fetching admin notifications:', err);
        setState(prev => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    },
    [user]
  );

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const createBatch = useCallback(
    async (payload: CreateBatchPayload): Promise<string> => {
      if (!user) throw new Error('Not authenticated');
      const idToken = await user.getIdToken();

      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send notification');
      }

      const data = await res.json();
      invalidateCache(CACHE_KEY);
      await fetchBatches(true);
      return data.batchId as string;
    },
    [user, fetchBatches]
  );

  return {
    ...state,
    refetch: () => fetchBatches(true),
    createBatch,
  };
}
