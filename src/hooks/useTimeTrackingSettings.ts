'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { invalidateCache } from '@/lib/queryCache';
import type {
  SettingSource,
  TimeTrackingOverrides,
  TimeTrackingSettingKey,
  TimeTrackingSettings,
} from '@/lib/timeTrackingSettings';

export interface TimeTrackingSettingsGroup {
  id: string;
  name: string;
  level: number;
  memberCount: number;
  overrides: TimeTrackingOverrides;
}

export interface TimeTrackingSettingsUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
  groups: string[];
  overrides: TimeTrackingOverrides;
  effective: TimeTrackingSettings;
  sources: Record<TimeTrackingSettingKey, SettingSource>;
}

/** `null` on a key clears that override (inherit). */
export type OverridePatch = Partial<Record<TimeTrackingSettingKey, boolean | number | string | null>>;

interface State {
  org: TimeTrackingSettings | null;
  groups: TimeTrackingSettingsGroup[];
  users: TimeTrackingSettingsUser[];
  loading: boolean;
  error: string | null;
}

// The User Management payload carries the resolved values too.
const ADMIN_USERS_CACHE_KEY = 'bluu_admin_users_v1';

/**
 * Shift Management → Organization Settings. Unlike most admin hooks this one
 * does not cache: it is fetched once per tab open, and an admin acting on a
 * stale view of who-inherits-what is worse than one extra request.
 */
export function useTimeTrackingSettings() {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ org: null, groups: [], users: [], loading: true, error: null });

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/time-tracking-settings', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        throw new Error(res.status === 403 ? 'You do not have access to these settings' : `Request failed: ${res.status}`);
      }
      const data = await res.json();
      setState({ org: data.org, groups: data.groups ?? [], users: data.users ?? [], loading: false, error: null });
    } catch (err) {
      setState(prev => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'Unknown error' }));
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const save = useCallback(
    async (body: Record<string, unknown>): Promise<number> => {
      if (!user) throw new Error('Not signed in');
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/time-tracking-settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed: ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      invalidateCache(ADMIN_USERS_CACHE_KEY);
      await fetchData();
      return typeof data.updatedUsers === 'number' ? data.updatedUsers : 0;
    },
    [user, fetchData],
  );

  const saveOrg = useCallback((settings: TimeTrackingSettings) => save({ scope: 'org', settings }), [save]);
  const saveGroup = useCallback(
    (id: string, overrides: OverridePatch) => save({ scope: 'group', id, overrides }),
    [save],
  );
  const saveUser = useCallback(
    (id: string, overrides: OverridePatch) => save({ scope: 'user', id, overrides }),
    [save],
  );

  return useMemo(
    () => ({ ...state, refetch: fetchData, saveOrg, saveGroup, saveUser }),
    [state, fetchData, saveOrg, saveGroup, saveUser],
  );
}
