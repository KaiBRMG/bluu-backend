'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { getCache, setCache } from '@/lib/queryCache';
import { buildTaskActor, filterVisibleTasks, type TaskActor } from '@/lib/taskAccess';
import type { TaskDocument, TaskPayload, TaskStatus } from '@/types/task';

/**
 * Short on purpose. Tasks are handed to you by someone else, and this page is
 * re-entered all day — a 5-minute cache hid work an admin had just assigned.
 * `refresh()` bypasses it entirely.
 */
const TTL = 60 * 1000;
/**
 * Namespaced by uid. Unlike Resources, nothing here is safe to share between two
 * people signing in on one tab: an admin's payload is every task in the company.
 */
const cacheKey = (uid: string) => `bluu_tasks_v1:${uid}`;

interface UseTasksResult {
  /** Null until the list AND the user's identity have both resolved. */
  tasks: TaskDocument[] | null;
  loading: boolean;
  /** True while a manual `refresh()` is in flight. */
  refreshing: boolean;
  /** Refetches the list from the server, ignoring the cache. Rejects on failure. */
  refresh: () => Promise<void>;
  error: string | null;
  actor: TaskActor;
  /** Every write returns the stored task and patches local state — no list refetch. */
  createTask: (payload: TaskPayload) => Promise<TaskDocument>;
  updateTask: (id: string, payload: Partial<TaskPayload>) => Promise<TaskDocument>;
  /** Optimistic: the pill moves at once and snaps back, with the error, on a failure. */
  setStatus: (id: string, status: TaskStatus) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
}

export function useTasks(): UseTasksResult {
  const { user } = useAuth();
  const { userData, loading: userDataLoading } = useUserData();
  const [raw, setRaw] = useState<TaskDocument[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = user?.uid ?? '';

  // The group list, not the `userData` snapshot: that object is rewritten by
  // every presence ping, and nothing here should react to one (rule 9i).
  const groupsKey = (userData?.groups ?? []).join('|');
  const actor = useMemo(
    () => buildTaskActor(uid, groupsKey ? groupsKey.split('|') : [], false),
    [uid, groupsKey]
  );

  const commit = useCallback(
    (updater: (prev: TaskDocument[]) => TaskDocument[]) => {
      setRaw(prev => {
        const next = updater(prev ?? []);
        if (uid) setCache(cacheKey(uid), next);
        return next;
      });
    },
    [uid]
  );

  useEffect(() => {
    if (!user) return;
    const cached = getCache<TaskDocument[]>(cacheKey(user.uid), TTL);
    if (cached) {
      setRaw(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    user.getIdToken().then(async idToken => {
      try {
        const res = await fetch('/api/tasks', {
          headers: { Authorization: `Bearer ${idToken}` },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`Tasks fetch failed: ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const tasks: TaskDocument[] = json.tasks ?? [];
        setRaw(tasks);
        setCache(cacheKey(user.uid), tasks);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load tasks');
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [user]);

  // Re-applies the server's read rule to whatever came back, cache hit included.
  const identityReady = !userDataLoading;
  const tasks = useMemo(
    () => (raw && identityReady ? filterVisibleTasks(raw, actor) : null),
    [raw, identityReady, actor]
  );

  const send = useCallback(async <T = { task: TaskDocument }>(path: string, init: RequestInit, fallback: string): Promise<T> => {
    if (!user) throw new Error('Not signed in');
    const idToken = await user.getIdToken();
    const res = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || fallback);
    return data;
  }, [user]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { tasks: fresh } = await send<{ tasks: TaskDocument[] }>('/api/tasks', { cache: 'no-store' }, 'Could not refresh tasks');
      setRaw(fresh);
      setError(null);
      if (uid) setCache(cacheKey(uid), fresh);
    } finally {
      setRefreshing(false);
    }
  }, [send, uid]);

  const createTask = useCallback(async (payload: TaskPayload) => {
    const { task } = await send('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }, 'Failed to create task');
    commit(prev => [task, ...prev]);
    return task;
  }, [send, commit]);

  const updateTask = useCallback(async (id: string, payload: Partial<TaskPayload>) => {
    const { task } = await send(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }, 'Failed to save task');
    commit(prev => prev.map(t => (t.id === id ? (task) : t)));
    return task;
  }, [send, commit]);

  const setStatus = useCallback(async (id: string, status: TaskStatus) => {
    // The updater captures what was on screen so a failure can put it back.
    let before: TaskDocument | undefined;
    commit(prev => {
      before = prev.find(t => t.id === id);
      return prev.map(t => (t.id === id ? { ...t, status } : t));
    });
    try {
      const { task } = await send(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }, 'Failed to update status');
      commit(prev => prev.map(t => (t.id === id ? (task) : t)));
    } catch (e) {
      const restore = before;
      if (restore) commit(prev => prev.map(t => (t.id === id ? restore : t)));
      throw e;
    }
  }, [send, commit]);

  const deleteTask = useCallback(async (id: string) => {
    await send(`/api/tasks/${id}`, { method: 'DELETE' }, 'Failed to delete task');
    commit(prev => prev.filter(t => t.id !== id));
  }, [send, commit]);

  return {
    tasks,
    loading: loading || !identityReady,
    refreshing,
    refresh,
    error,
    actor,
    createTask,
    updateTask,
    setStatus,
    deleteTask,
  };
}
