'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '@/components/AuthProvider';
import { apiRequest } from '@/lib/clientApi';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import {
  EMPTY_TAXONOMY,
  type PromptCreateInput,
  type PromptDocument,
  type PromptMetaInput,
  type PromptTaxonomy,
  type PromptVersion,
} from '@/types/promptLibrary';

const CACHE_KEY = 'bluu_prompt_library_v1';
const TTL = 5 * 60 * 1000;

interface Snapshot {
  prompts: PromptDocument[];
  taxonomy: PromptTaxonomy;
}

interface PromptLibraryValue extends Snapshot {
  loading: boolean;
  error: string | null;
  refresh: () => void;

  /** Version history, lazily fetched per prompt and kept for the session. */
  getVersions: (id: string) => Promise<PromptVersion[]>;

  createPrompt: (input: PromptCreateInput) => Promise<PromptDocument>;
  saveVersion: (
    id: string,
    text: string,
    basedOn: number
  ) => Promise<{ prompt: PromptDocument; version: PromptVersion }>;
  updateMeta: (id: string, input: PromptMetaInput) => Promise<PromptDocument>;
  removePrompt: (id: string) => Promise<void>;
  addLabels: (input: { categories?: string[]; tags?: string[] }) => Promise<void>;
  removeLabel: (kind: 'category' | 'tag', label: string) => Promise<void>;
}

const PromptLibraryContext = createContext<PromptLibraryValue | null>(null);

async function readError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = await res.json();
    if (typeof body?.error === 'string') message = body.error;
  } catch {
    // Non-JSON error body — the fallback stands.
  }
  throw new Error(message);
}

/**
 * Holds the entire Prompt Library for the whole `/applications/apps-prompt-library`
 * route subtree.
 *
 * Mounted from the segment layout, so moving between the home screen, an LLM
 * page and a detail card re-uses one fetch rather than issuing three. Mutations
 * patch this state and the sessionStorage mirror in place — a save never
 * triggers a re-read of the collection.
 */
export function PromptLibraryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot>({ prompts: [], taxonomy: EMPTY_TAXONOMY });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Version histories are far larger than the head docs and are only needed on
  // the detail card, so they are fetched on demand and memoised for the session.
  const versionCache = useRef(new Map<string, PromptVersion[]>());

  const refresh = useCallback(() => {
    invalidateCache(CACHE_KEY);
    versionCache.current.clear();
    setRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    if (!user) return;

    const cached = getCache<Snapshot>(CACHE_KEY, TTL);
    if (cached) {
      setSnapshot(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await apiRequest('/api/prompt-library');
        if (!res.ok) await readError(res, 'Failed to load the prompt library');
        const body = await res.json();
        if (cancelled) return;

        const next: Snapshot = {
          prompts: body.prompts ?? [],
          taxonomy: body.taxonomy ?? EMPTY_TAXONOMY,
        };
        setSnapshot(next);
        setCache(CACHE_KEY, next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load the prompt library');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, refreshKey]);

  const getVersions = useCallback(async (id: string) => {
    const hit = versionCache.current.get(id);
    if (hit) return hit;

    const res = await apiRequest(`/api/prompt-library/${id}/versions`);
    if (!res.ok) await readError(res, 'Failed to load version history');
    const body = await res.json();
    const versions: PromptVersion[] = body.versions ?? [];
    versionCache.current.set(id, versions);
    return versions;
  }, []);

  const createPrompt = useCallback(
    async (input: PromptCreateInput) => {
      const res = await apiRequest('/api/prompt-library', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!res.ok) await readError(res, 'Failed to create the prompt');
      const { prompt } = (await res.json()) as { prompt: PromptDocument };

      setSnapshot(prev => {
        const next: Snapshot = {
          prompts: [prompt, ...prev.prompts],
          taxonomy: {
            categories: prev.taxonomy.categories.includes(prompt.category)
              ? prev.taxonomy.categories
              : [...prev.taxonomy.categories, prompt.category],
            tags: Array.from(new Set([...prev.taxonomy.tags, ...prompt.tags])),
          },
        };
        setCache(CACHE_KEY, next);
        return next;
      });
      return prompt;
    },
    []
  );

  const saveVersion = useCallback(async (id: string, text: string, basedOn: number) => {
    const res = await apiRequest(`/api/prompt-library/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify({ text, basedOn }),
    });
    if (!res.ok) await readError(res, 'Failed to save the new version');
    const result = (await res.json()) as { prompt: PromptDocument; version: PromptVersion };

    const known = versionCache.current.get(id);
    if (known) versionCache.current.set(id, [result.version, ...known]);

    setSnapshot(prev => {
      const next: Snapshot = {
        ...prev,
        prompts: prev.prompts.map(p => (p.id === id ? result.prompt : p)),
      };
      setCache(CACHE_KEY, next);
      return next;
    });
    return result;
  }, []);

  const updateMeta = useCallback(async (id: string, input: PromptMetaInput) => {
    const res = await apiRequest(`/api/prompt-library/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    if (!res.ok) await readError(res, 'Failed to update the prompt');
    const { prompt } = (await res.json()) as { prompt: PromptDocument };

    setSnapshot(prev => {
      const next: Snapshot = {
        prompts: prev.prompts.map(p => (p.id === id ? prompt : p)),
        taxonomy: {
          categories: prev.taxonomy.categories.includes(prompt.category)
            ? prev.taxonomy.categories
            : [...prev.taxonomy.categories, prompt.category],
          tags: Array.from(new Set([...prev.taxonomy.tags, ...prompt.tags])),
        },
      };
      setCache(CACHE_KEY, next);
      return next;
    });
    return prompt;
  }, []);

  const removePrompt = useCallback(async (id: string) => {
    const res = await apiRequest(`/api/prompt-library/${id}`, { method: 'DELETE' });
    if (!res.ok) await readError(res, 'Failed to delete the prompt');

    versionCache.current.delete(id);
    setSnapshot(prev => {
      const next: Snapshot = { ...prev, prompts: prev.prompts.filter(p => p.id !== id) };
      setCache(CACHE_KEY, next);
      return next;
    });
  }, []);

  const addLabels = useCallback(async (input: { categories?: string[]; tags?: string[] }) => {
    const res = await apiRequest('/api/prompt-library/taxonomy', {
      method: 'POST',
      body: JSON.stringify({ categories: input.categories ?? [], tags: input.tags ?? [] }),
    });
    if (!res.ok) await readError(res, 'Failed to save the label');
    const { taxonomy } = (await res.json()) as { taxonomy: PromptTaxonomy };

    setSnapshot(prev => {
      const next: Snapshot = { ...prev, taxonomy };
      setCache(CACHE_KEY, next);
      return next;
    });
  }, []);

  const removeLabel = useCallback(async (kind: 'category' | 'tag', label: string) => {
    const res = await apiRequest(
      `/api/prompt-library/taxonomy?kind=${kind}&label=${encodeURIComponent(label)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) await readError(res, 'Failed to remove the label');
    const { taxonomy } = (await res.json()) as { taxonomy: PromptTaxonomy };

    setSnapshot(prev => {
      const next: Snapshot = { ...prev, taxonomy };
      setCache(CACHE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<PromptLibraryValue>(
    () => ({
      ...snapshot,
      loading,
      error,
      refresh,
      getVersions,
      createPrompt,
      saveVersion,
      updateMeta,
      removePrompt,
      addLabels,
      removeLabel,
    }),
    [
      snapshot,
      loading,
      error,
      refresh,
      getVersions,
      createPrompt,
      saveVersion,
      updateMeta,
      removePrompt,
      addLabels,
      removeLabel,
    ]
  );

  return <PromptLibraryContext.Provider value={value}>{children}</PromptLibraryContext.Provider>;
}

export function usePromptLibrary(): PromptLibraryValue {
  const ctx = useContext(PromptLibraryContext);
  if (!ctx) throw new Error('usePromptLibrary must be used inside PromptLibraryProvider');
  return ctx;
}
