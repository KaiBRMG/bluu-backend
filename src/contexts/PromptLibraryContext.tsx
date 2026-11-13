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
  EMPTY_VIEWER,
  mergeModels,
  type PromptAccess,
  type PromptAccessChange,
  type PromptCreateInput,
  type PromptDocument,
  type PromptRole,
  type PromptMetaInput,
  type PromptModel,
  type PromptTaxonomy,
  type PromptViewerInfo,
  type PromptVersion,
} from '@/types/promptLibrary';

// Bumped from _v2: the shape gained `access`, `myRole` and `viaAdmin`, and the
// list is now filtered per person — a stale v2 entry would still hold prompts
// that are no longer theirs.
const CACHE_KEY = 'bluu_prompt_library_v3';
const SHOW_ALL_KEY = 'bluu_prompt_library_show_all';
const TTL = 5 * 60 * 1000;

interface Snapshot {
  prompts: PromptDocument[];
  taxonomy: PromptTaxonomy;
  /** Who the server says the caller is — never inferred on the client. */
  viewer: PromptViewerInfo;
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

export type AccessChangeInput = PromptAccessChange;

interface PromptLibraryValue extends Snapshot {
  /**
   * Everything the server sent, including the prompts Show-all is hiding.
   * Lookups by id (the detail card, deep links) read THIS, not `prompts`: a link
   * to a prompt an admin has not switched on must still open it.
   */
  allPrompts: PromptDocument[];
  /**
   * Admin-only. True when the caller is an admin, i.e. may reveal the prompts
   * that are outside their own grants.
   */
  canShowAll: boolean;
  /** Whether those admin-only prompts are currently mixed into `prompts`. */
  showAll: boolean;
  setShowAll: (on: boolean) => void;
  /** How many prompts the switch would reveal — shown beside it. */
  hiddenByAdminCount: number;

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
  /**
   * Applies a delta to who the prompt is shared with. Patches state from the
   * response — the library is never re-read. Resolves to what the caller holds
   * NOW; `null` means they lost the prompt and it has left their board.
   */
  updateAccess: (id: string, change: AccessChangeInput) => Promise<PromptRole | null>;

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
  const [showAll, setShowAllState] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(SHOW_ALL_KEY) === '1';
    } catch {
      return false; // Storage blocked — the switch simply starts off.
    }
  });
  const setShowAll = useCallback((on: boolean) => {
    setShowAllState(on);
    try {
      localStorage.setItem(SHOW_ALL_KEY, on ? '1' : '0');
    } catch {
      // Not persisted; still applies for this session.
    }
  }, []);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    prompts: [],
    taxonomy: EMPTY_TAXONOMY,
    viewer: EMPTY_VIEWER,
  });
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
          viewer: body.viewer ?? EMPTY_VIEWER,
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
          ...prev,
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
        ...prev,
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

  const updateAccess = useCallback(async (id: string, change: AccessChangeInput) => {
    const res = await apiRequest(`/api/prompt-library/${id}/access`, {
      method: 'PUT',
      body: JSON.stringify(change),
    });
    if (!res.ok) await readError(res, 'Failed to update who can access this prompt');
    const body = (await res.json()) as {
      access: PromptAccess | null;
      myRole: PromptRole | null;
      viaAdmin: boolean;
    };

    setSnapshot(prev => {
      const next: Snapshot = {
        ...prev,
        prompts:
          body.myRole === null
            ? prev.prompts.filter(p => p.id !== id)
            : prev.prompts.map(p =>
                p.id === id
                  ? { ...p, access: body.access, myRole: body.myRole!, viaAdmin: body.viaAdmin }
                  : p
              ),
      };
      setCache(CACHE_KEY, next);
      return next;
    });
    if (body.myRole === null) versionCache.current.delete(id);
    return body.myRole;
  }, []);

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

  // An admin's everyday view is the prompts shared with them; the rest sit
  // behind the switch. Every consumer reads `prompts`, so search, the model
  // pages and the counts all agree on what "the library" currently is.
  const canShowAll = snapshot.viewer.isAdmin;
  const hiddenByAdminCount = useMemo(
    () => snapshot.prompts.filter(p => p.viaAdmin).length,
    [snapshot.prompts]
  );
  const visibleSnapshot = useMemo<Snapshot>(
    () =>
      showAll ? snapshot : { ...snapshot, prompts: snapshot.prompts.filter(p => !p.viaAdmin) },
    [snapshot, showAll]
  );

  const value = useMemo<PromptLibraryValue>(
    () => ({
      ...visibleSnapshot,
      allPrompts: snapshot.prompts,
      canShowAll,
      showAll,
      setShowAll,
      hiddenByAdminCount,
      updateAccess,
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
      visibleSnapshot,
      snapshot.prompts,
      canShowAll,
      showAll,
      setShowAll,
      hiddenByAdminCount,
      updateAccess,
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
