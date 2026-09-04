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
  mergeModels,
  type PromptCreateInput,
  type PromptDocument,
  type PromptMetaInput,
  type PromptModel,
  type PromptTaxonomy,
  type PromptVersion,
} from '@/types/promptLibrary';

// Bumped from _v1: the cached shape gained `taxonomy.models`, `llmTypes` and
// the rich-text body, and a stale v1 entry would render a modelless library.
const CACHE_KEY = 'bluu_prompt_library_v2';
const TTL = 5 * 60 * 1000;

interface Snapshot {
  prompts: PromptDocument[];
  taxonomy: PromptTaxonomy;
}

/** What a save carries beyond the text: the rich body and the author's note. */
export interface SaveVersionInput {
  text: string;
  textHtml: string | null;
  editNote: string;
  basedOn: number;
}

/** The same body, aimed at a version that already exists rather than a new one. */
export interface OverwriteVersionInput {
  text: string;
  textHtml: string | null;
  editNote: string;
  /** The version being written over — the one on screen, head or not. */
  version: number;
}

interface PromptLibraryValue extends Snapshot {
  loading: boolean;
  error: string | null;
  refresh: () => void;

  /** Built-ins plus everything the team has added, most recently added first. */
  models: PromptModel[];
  modelsById: Record<string, PromptModel>;

  /** Version history, lazily fetched per prompt and kept for the session. */
  getVersions: (id: string) => Promise<PromptVersion[]>;

  createPrompt: (input: PromptCreateInput) => Promise<PromptDocument>;
  saveVersion: (
    id: string,
    input: SaveVersionInput
  ) => Promise<{ prompt: PromptDocument; version: PromptVersion }>;
  /** Saves over an existing version instead of appending one. */
  overwriteVersion: (
    id: string,
    input: OverwriteVersionInput
  ) => Promise<{ prompt: PromptDocument; version: PromptVersion }>;
  updateMeta: (id: string, input: PromptMetaInput) => Promise<PromptDocument>;
  removePrompt: (id: string) => Promise<void>;

  /**
   * Mints (or returns) the prompt's public link. Idempotent — copying twice
   * gives the same URL, so a link already sent keeps working.
   */
  shareLink: (id: string) => Promise<string>;
  /** Withdraws the public link. A later re-share mints a NEW one. */
  revokeShare: (id: string) => Promise<void>;

  addLabels: (input: {
    categories?: string[];
    tags?: string[];
    models?: { id: string; name: string }[];
  }) => Promise<void>;
  removeLabel: (kind: 'category' | 'tag' | 'model', label: string) => Promise<void>;
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
            ...prev.taxonomy,
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

  const saveVersion = useCallback(async (id: string, input: SaveVersionInput) => {
    const res = await apiRequest(`/api/prompt-library/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify(input),
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

  /**
   * Writes over a version that already exists. The cached history is patched in
   * place rather than re-fetched — the response carries the version exactly as
   * stored, so a re-read would only confirm what we already hold.
   */
  const overwriteVersion = useCallback(async (id: string, input: OverwriteVersionInput) => {
    const res = await apiRequest(`/api/prompt-library/${id}/versions`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    if (!res.ok) await readError(res, 'Failed to save the version');
    const result = (await res.json()) as { prompt: PromptDocument; version: PromptVersion };

    const known = versionCache.current.get(id);
    if (known) {
      versionCache.current.set(
        id,
        known.map(v => (v.version === result.version.version ? result.version : v))
      );
    }

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
          ...prev.taxonomy,
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

  /** Patches one prompt's `shareId` in state and the sessionStorage mirror —
   *  no write is ever followed by a re-read of the collection. */
  const patchShareId = useCallback((id: string, shareId: string | null) => {
    setSnapshot(prev => {
      const next: Snapshot = {
        ...prev,
        prompts: prev.prompts.map(p => (p.id === id ? { ...p, shareId } : p)),
      };
      setCache(CACHE_KEY, next);
      return next;
    });
  }, []);

  const shareLink = useCallback(
    async (id: string) => {
      const res = await apiRequest(`/api/prompt-library/${id}/share`, { method: 'POST' });
      if (!res.ok) await readError(res, 'Failed to create the share link');
      const { shareId, url } = (await res.json()) as { shareId: string; url: string };
      patchShareId(id, shareId);
      return url;
    },
    [patchShareId]
  );

  const revokeShare = useCallback(
    async (id: string) => {
      const res = await apiRequest(`/api/prompt-library/${id}/share`, { method: 'DELETE' });
      if (!res.ok) await readError(res, 'Failed to withdraw the share link');
      patchShareId(id, null);
    },
    [patchShareId]
  );

  const addLabels = useCallback(async (input: {
    categories?: string[];
    tags?: string[];
    models?: { id: string; name: string }[];
  }) => {
    const res = await apiRequest('/api/prompt-library/taxonomy', {
      method: 'POST',
      body: JSON.stringify({
        categories: input.categories ?? [],
        tags: input.tags ?? [],
        models: input.models ?? [],
      }),
    });
    if (!res.ok) await readError(res, 'Failed to save the label');
    const { taxonomy } = (await res.json()) as { taxonomy: PromptTaxonomy };

    setSnapshot(prev => {
      const next: Snapshot = { ...prev, taxonomy };
      setCache(CACHE_KEY, next);
      return next;
    });
  }, []);

  const removeLabel = useCallback(async (kind: 'category' | 'tag' | 'model', label: string) => {
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

  // The built-in five merged with whatever the team has added, newest first.
  // Derived here so every surface shares one ordering and one id → model map.
  const models = useMemo(() => mergeModels(snapshot.taxonomy.models), [snapshot.taxonomy.models]);
  const modelsById = useMemo(() => {
    const map: Record<string, PromptModel> = {};
    for (const m of models) map[m.id] = m;
    return map;
  }, [models]);

  const value = useMemo<PromptLibraryValue>(
    () => ({
      ...snapshot,
      loading,
      error,
      refresh,
      models,
      modelsById,
      getVersions,
      createPrompt,
      saveVersion,
      overwriteVersion,
      updateMeta,
      removePrompt,
      shareLink,
      revokeShare,
      addLabels,
      removeLabel,
    }),
    [
      snapshot,
      loading,
      error,
      refresh,
      models,
      modelsById,
      getVersions,
      createPrompt,
      saveVersion,
      overwriteVersion,
      updateMeta,
      removePrompt,
      shareLink,
      revokeShare,
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
