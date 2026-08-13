/**
 * Shared Prompt Library types. Client-safe — imported by pages, hooks, and the
 * server service alike, so nothing here may touch firebase-admin.
 */

export const LLM_TYPES = ['chatgpt', 'claude', 'grok', 'higgsfield', 'wavespeed'] as const;

export type LlmType = (typeof LLM_TYPES)[number];

export interface LlmMeta {
  /** Stable id — the Firestore value and the URL segment. */
  id: LlmType;
  /** Display name, shown bold on the home tiles. */
  name: string;
  /** Normalised mark from scripts/build-prompt-library-logos.js. */
  logo: string;
}

export const LLM_META: Record<LlmType, LlmMeta> = {
  chatgpt: { id: 'chatgpt', name: 'ChatGPT', logo: '/prompt-library-llm-logos/chatgpt.webp' },
  claude: { id: 'claude', name: 'Claude', logo: '/prompt-library-llm-logos/claude.webp' },
  grok: { id: 'grok', name: 'Grok', logo: '/prompt-library-llm-logos/grok.webp' },
  higgsfield: { id: 'higgsfield', name: 'Higgsfield', logo: '/prompt-library-llm-logos/higgsfield.webp' },
  wavespeed: { id: 'wavespeed', name: 'WaveSpeed', logo: '/prompt-library-llm-logos/wavespeed.webp' },
};

export const LLM_LIST: LlmMeta[] = LLM_TYPES.map(t => LLM_META[t]);

export function isLlmType(v: unknown): v is LlmType {
  return typeof v === 'string' && (LLM_TYPES as readonly string[]).includes(v);
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
  llmType: LlmType;
  category: string;
  title: string;
  tags: string[];
  /** Current version's prompt text. */
  text: string;
  /** Version number of `text`. Starts at 1. */
  version: number;
  /** Highest version ever written — equals `version`, kept explicit for clarity. */
  versionCount: number;
  /** Which version the current one was edited from; null on v1. */
  basedOn: number | null;
  /** Summary of the edit that produced the current version. */
  change: ChangeStat | null;
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
  basedOn: number | null;
  change: ChangeStat | null;
  createdTime: string;
  createdBy: string;
}

/**
 * Managed category and tag lists. Labels persist here even when no prompt
 * currently uses them, so an empty category the user coined stays selectable.
 */
export interface PromptTaxonomy {
  categories: string[];
  tags: string[];
}

export const EMPTY_TAXONOMY: PromptTaxonomy = { categories: [], tags: [] };

/** What a client may send when creating a prompt. */
export interface PromptCreateInput {
  llmType: LlmType;
  category: string;
  title: string;
  tags: string[];
  text: string;
}

/** Metadata a client may change without cutting a new version. */
export interface PromptMetaInput {
  llmType?: LlmType;
  category?: string;
  title?: string;
  tags?: string[];
  isArchived?: boolean;
}
