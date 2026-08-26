'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import {
  buildResourceActor,
  canManageResources,
  canWriteResource,
  filterVisibleResources,
  getWritableGroups,
  type ResourceActor,
} from '@/lib/resourceAccess';
import type { ResourceDocument } from '@/types/resource';

// v2: the payload changed shape at the Resources/Resource Management merge —
// a manager now also receives Unlisted resources, so a v1 cache is not a valid
// answer for them.
const DOCS_CACHE_KEY = 'bluu_resources_v2';
const TTL = 5 * 60 * 1000;

/** Fields the management dialog can send when creating or updating a resource. */
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

interface UseResourcesResult {
  documents: ResourceDocument[] | null;
  /** Distinct types across the resources this user can see. */
  types: string[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** The caller's access identity — the same one the API authorises against. */
  actor: ResourceActor;
  /** True when the user may manage at least one group's resources. */
  canManage: boolean;
  /** Group ids the user may tag a resource with. */
  writableGroups: string[];
  /** Whether this specific resource's options menu should be offered. */
  canEdit: (doc: ResourceDocument) => boolean;
  createResource: (payload: ResourcePayload) => Promise<void>;
  updateResource: (id: string, payload: Partial<ResourcePayload>) => Promise<void>;
  deleteResource: (id: string) => Promise<void>;
}

export function useResources(): UseResourcesResult {
  const { user } = useAuth();
  const { userData, loading: userDataLoading } = useUserData();
  const [rawDocuments, setRawDocuments] = useState<ResourceDocument[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const actor = useMemo(
    () => buildResourceActor(user?.uid ?? '', userData?.groups, false),
    [user?.uid, userData?.groups]
  );

  const refresh = useCallback(() => {
    invalidateCache(DOCS_CACHE_KEY);
    setRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    if (!user) return;

    const cachedDocs = getCache<ResourceDocument[]>(DOCS_CACHE_KEY, TTL);
    if (cachedDocs) {
      setRawDocuments(cachedDocs);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    user.getIdToken().then(async idToken => {
      try {
        const res = await fetch('/api/resources', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) throw new Error(`Resources fetch failed: ${res.status}`);

        const json = await res.json();
        if (cancelled) return;

        const docs: ResourceDocument[] = json.documents ?? [];
        setRawDocuments(docs);
        setCache(DOCS_CACHE_KEY, docs);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load resources');
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [user, refreshKey]);

  /**
   * The server has already applied the visibility rule; this re-applies it
   * against the *current* user. The sessionStorage payload is not namespaced by
   * uid and nothing clears it on logout, so without this a second user in the
   * same tab could read the previous one's Unlisted rows out of a cache hit.
   *
   * Identity gates it: until the user doc resolves the actor has no groups, and
   * filtering against an empty identity would blank the list on every load. The
   * gate is the snapshot's *loading* flag, not `userData` itself — a user doc
   * that resolves to nothing must still finish loading, or the home widget's
   * `useBootPhase('home-resources')` would wait forever.
   */
  const identityReady = !userDataLoading;
  const documents = useMemo(
    () => (rawDocuments && identityReady ? filterVisibleResources(rawDocuments, actor) : null),
    [rawDocuments, identityReady, actor]
  );

  // Derived client-side rather than fetched: the type filter should offer
  // exactly the types present in what this user can actually see, and it saves
  // the second round trip the old /api/resources/types endpoint cost.
  const types = useMemo(() => {
    if (!documents) return null;
    const set = new Set<string>();
    for (const d of documents) for (const t of d.types) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [documents]);

  /** Every write refetches, so the list reflects what the server actually stored. */
  const write = useCallback(async (path: string, init: RequestInit, fallback: string) => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    const res = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || fallback);
    }
    refresh();
  }, [user, refresh]);

  const createResource = useCallback(
    (payload: ResourcePayload) =>
      write('/api/resources', { method: 'POST', body: JSON.stringify(payload) },
        'Failed to create resource'),
    [write]
  );

  const updateResource = useCallback(
    (id: string, payload: Partial<ResourcePayload>) =>
      write(`/api/resources/${id}`, { method: 'PUT', body: JSON.stringify(payload) },
        'Failed to update resource'),
    [write]
  );

  const deleteResource = useCallback(
    (id: string) =>
      write(`/api/resources/${id}`, { method: 'DELETE' }, 'Failed to delete resource'),
    [write]
  );

  const canEdit = useCallback(
    (doc: ResourceDocument) => canWriteResource(doc, actor),
    [actor]
  );

  return {
    documents,
    types,
    // Identity is part of loading here: `documents` is null until the user doc
    // resolves, and a consumer must not read that as "nothing shared with you".
    loading: loading || !identityReady,
    error,
    refresh,
    actor,
    canManage: canManageResources(actor),
    writableGroups: useMemo(() => Array.from(getWritableGroups(actor)), [actor]),
    canEdit,
    createResource,
    updateResource,
    deleteResource,
  };
}
