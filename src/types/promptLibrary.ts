/**
 * Shared Prompt Library types. Client-safe — imported by pages, hooks, and the
 * server service alike, so nothing here may touch firebase-admin.
 */

/**
 * The five models the library shipped with. They stay in code rather than in
 * Firestore so the library still renders if the meta document is missing, and
 * so their normalised marks keep their explicit paths. Anything a user adds
 * lives in `prompt-library-meta/taxonomy.models` and is merged on top.
 */
export const BUILTIN_LLM_TYPES = ['chatgpt', 'claude', 'grok', 'higgsfield', 'wavespeed'] as const;

export type BuiltinLlmType = (typeof BUILTIN_LLM_TYPES)[number];

/** An llmType is now an open string — the managed model list decides validity. */
export type LlmType = string;

export interface PromptModel {
  /** Stable id — the Firestore value and the URL segment. */
  id: LlmType;
  /** Display name, shown bold on the home tiles. */
  name: string;
  /**
   * Explicit mark path, set only for the built-ins whose assets are normalised
   * by scripts/build-prompt-library-logos.js. `null` for user-added models —
   * `llmLogoCandidates` derives the path from the id instead, so dropping
   * `<id>.png` into public/prompt-library-llm-logos makes the icon appear with
   * no code change. Until that file exists the model renders without a mark.
   */
  logo: string | null;
  /**
   * Sort key — descending, so the most recently added model leads the list.
   * Built-ins carry non-positive seeds (`-index`) that preserve their original
   * order among themselves and always sort below anything user-added.
   */
  addedAt: number;
  builtin: boolean;
}

const BUILTIN_NAMES: Record<BuiltinLlmType, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  grok: 'Grok',
  higgsfield: 'Higgsfield',
  wavespeed: 'WaveSpeed',
};

export const BUILTIN_MODELS: PromptModel[] = BUILTIN_LLM_TYPES.map((id, i) => ({
  id,
  name: BUILTIN_NAMES[id],
  logo: `/prompt-library-llm-logos/${id}.webp`,
  addedAt: -i,
  builtin: true,
}));

export const LOGO_DIR = '/prompt-library-llm-logos';

/**
 * Where a model's mark might live, best first. A user-added model has no
 * normalised WebP until someone runs the build script, so the raw PNG they
 * committed is tried next; `LlmMark` falls through to a monogram when neither
 * resolves.
 */
export function llmLogoCandidates(model: PromptModel | undefined): string[] {
  if (!model) return [];
  if (model.logo) return [model.logo];
  return [`${LOGO_DIR}/${model.id}.webp`, `${LOGO_DIR}/${model.id}.png`];
}

/** Merges the managed list on top of the built-ins, newest-added first. */
export function mergeModels(custom: PromptModel[]): PromptModel[] {
  const byId = new Map<string, PromptModel>();
  for (const m of BUILTIN_MODELS) byId.set(m.id, m);
  // A custom entry sharing a built-in id only renames it; the mark stays.
  for (const m of custom) {
    const existing = byId.get(m.id);
    byId.set(m.id, existing?.builtin ? { ...existing, name: m.name || existing.name } : m);
  }
  return Array.from(byId.values()).sort((a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name));
}

/** Slug used as the model id and the URL segment. */
export function toModelId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function isValidModelId(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);
}

/** How much a version changed relative to the one it was edited from. */
export type ChangeKind = 'initial' | 'tweak' | 'edit' | 'rewrite';

/** Where in the prompt the edit landed. Cheap to compute, useful to read. */
export type ChangeRegion = 'none' | 'start' | 'middle' | 'end' | 'throughout';

export interface ChangeStat {
  added: number;
  removed: number;
  /** 0-1 share of the prompt that moved. Drives `kind`. */
  ratio: number;
  region: ChangeRegion;
  kind: ChangeKind;
}

/**
 * The head of a prompt. Carries the CURRENT text so the list, the search index
 * and the detail card's default view all come from one collection read — the
 * `versions` subcollection is only touched when someone opens the history.
 */
export interface PromptDocument {
  id: string;
  /**
   * Every model this prompt is for. Read back from the legacy single `llmType`
   * field when `llmTypes` is absent, and still written alongside it, so a
   * document written before multi-model support keeps working untouched.
   */
  llmTypes: LlmType[];
  category: string;
  title: string;
  tags: string[];
  /**
   * Current version's prompt text, PLAIN. Canonical for copy, search and diff —
   * `textHtml` is the presentation layer on top of it.
   */
  text: string;
  /** Rich-text rendering of `text`, or null for prompts saved as plain text. */
  textHtml: string | null;
  /** Version number of `text`. Starts at 1. */
  version: number;
  /** Highest version ever written — equals `version`, kept explicit for clarity. */
  versionCount: number;
  /** Which version the current one was edited from; null on v1. */
  basedOn: number | null;
  /** Summary of the edit that produced the current version. */
  change: ChangeStat | null;
  /** The author's note explaining the current version. '' when none was given. */
  editNote: string;
  isArchived: boolean;
  createdTime: string;
  createdBy: string;
  lastUpdatedTime: string;
  lastUpdatedBy: string;
}

/** One entry in `prompt-library/{id}/versions`. Lazy-loaded. */
export interface PromptVersion {
  version: number;
  text: string;
  textHtml: string | null;
  basedOn: number | null;
  change: ChangeStat | null;
  /** Why this version exists, in the author's words. '' when none was given. */
  editNote: string;
  createdTime: string;
  createdBy: string;
}

/**
 * Managed category, tag and model lists. Labels persist here even when no
 * prompt currently uses them, so an empty category the user coined stays
 * selectable.
 */
export interface PromptTaxonomy {
  categories: string[];
  tags: string[];
  /** User-added models only. Merge with `BUILTIN_MODELS` via `mergeModels`. */
  models: PromptModel[];
}

export const EMPTY_TAXONOMY: PromptTaxonomy = { categories: [], tags: [], models: [] };

/** What a client may send when creating a prompt. */
export interface PromptCreateInput {
  llmTypes: LlmType[];
  category: string;
  title: string;
  tags: string[];
  text: string;
  textHtml?: string | null;
}

/** Metadata a client may change without cutting a new version. */
export interface PromptMetaInput {
  llmTypes?: LlmType[];
  category?: string;
  title?: string;
  tags?: string[];
  isArchived?: boolean;
}

export const MAX_EDIT_NOTE_LENGTH = 2000;
export const MAX_MODELS_PER_PROMPT = 12;
