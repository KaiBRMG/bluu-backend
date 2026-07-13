'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import type { ResourceDocument } from '@/types/resource';

const DOCS_CACHE_KEY = 'bluu_resources_v1';
const TYPES_CACHE_KEY = 'bluu_resources_types_v1';
const TTL = 5 * 60 * 1000;

interface UseResourcesResult {
  documents: ResourceDocument[] | null;
  types: string[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useResources(): UseResourcesResult {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<ResourceDocument[] | null>(null);
  const [types, setTypes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    invalidateCache(DOCS_CACHE_KEY);
    invalidateCache(TYPES_CACHE_KEY);
    setRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    if (!user) return;

    const cachedDocs = getCache<ResourceDocument[]>(DOCS_CACHE_KEY, TTL);
    const cachedTypes = getCache<string[]>(TYPES_CACHE_KEY, TTL);
    if (cachedDocs && cachedTypes) {
      setDocuments(cachedDocs);
      setTypes(cachedTypes);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    user.getIdToken().then(async idToken => {
      const headers = { Authorization: `Bearer ${idToken}` };
      try {
        const [docsRes, typesRes] = await Promise.all([
          fetch('/api/resources', { headers }),
          fetch('/api/resources/types', { headers }),
        ]);

        if (!docsRes.ok || !typesRes.ok) {
          throw new Error(`Resources fetch failed: docs=${docsRes.status} types=${typesRes.status}`);
        }

        const docsJson = await docsRes.json();
        const typesJson = await typesRes.json();

        if (cancelled) return;

        const docs: ResourceDocument[] = docsJson.documents ?? [];
        const t: string[] = typesJson.types ?? [];

        setDocuments(docs);
        setTypes(t);
        setCache(DOCS_CACHE_KEY, docs);
        setCache(TYPES_CACHE_KEY, t);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load resources');
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [user, refreshKey]);

  return { documents, types, loading, error, refresh };
}
