'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import type { ResourceDocument } from '@/types/resource';

/** Fields the management UI can send when creating/updating a resource. */
export interface ResourcePayload {
  name: string;
  url: string | null;
  isNotionPage: boolean;
  notionPageUrl: string;
  groups: string[];
  types: string[];
  status: string;
  icon: ResourceDocument['icon'];
  users: string[];
}

interface AdminResourcesState {
  documents: ResourceDocument[];
  loading: boolean;
  error: string | null;
}

const CACHE_KEY = 'bluu_admin_resources_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;
// Public apps-resources hook cache keys — busted on any write so the
// end-user page reflects management changes without a hard reload.
const PUBLIC_DOCS_KEY = 'bluu_resources_v1';
const PUBLIC_TYPES_KEY = 'bluu_resources_types_v1';

export function useAdminResources() {
  const { user } = useAuth();
  const [state, setState] = useState<AdminResourcesState>(() => {
    const cached = getCache<ResourceDocument[]>(CACHE_KEY, CACHE_TTL_MS);
    return cached
      ? { documents: cached, loading: false, error: null }
      : { documents: [], loading: true, error: null };
  });

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user) return;

    if (!forceRefresh) {
      const cached = getCache<ResourceDocument[]>(CACHE_KEY, CACHE_TTL_MS);
      if (cached) {
        setState({ documents: cached, loading: false, error: null });
        return;
      }
    }

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/resources', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error('Access denied');
        throw new Error(`Failed to fetch resources: ${res.status}`);
      }
      const data = await res.json();
      const documents: ResourceDocument[] = data.documents ?? [];
      setCache(CACHE_KEY, documents);
      setState({ documents, loading: false, error: null });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const bustPublicCaches = () => {
    invalidateCache(CACHE_KEY);
    invalidateCache(PUBLIC_DOCS_KEY);
    invalidateCache(PUBLIC_TYPES_KEY);
  };

  const createResource = useCallback(async (payload: ResourcePayload) => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    const res = await fetch('/api/admin/resources', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to create resource');
    }
    bustPublicCaches();
    await fetchData(true);
  }, [user, fetchData]);

  const updateResource = useCallback(async (id: string, payload: Partial<ResourcePayload>) => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/admin/resources/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to update resource');
    }
    bustPublicCaches();
    await fetchData(true);
  }, [user, fetchData]);

  const deleteResource = useCallback(async (id: string) => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/admin/resources/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete resource');
    }
    bustPublicCaches();
    await fetchData(true);
  }, [user, fetchData]);

  return useMemo(() => ({
    ...state,
    refetch: () => fetchData(true),
    createResource,
    updateResource,
    deleteResource,
  }), [state, fetchData, createResource, updateResource, deleteResource]);
}
