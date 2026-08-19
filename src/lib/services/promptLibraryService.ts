import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { summariseChange } from '@/lib/promptDiff';
import { htmlToPlainText, sanitizePromptHtml } from '@/lib/promptHtml';
import {
  EMPTY_TAXONOMY,
  isValidModelId,
  MAX_EDIT_NOTE_LENGTH,
  MAX_MODELS_PER_PROMPT,
  type ChangeStat,
  type LlmType,
  type PromptCreateInput,
  type PromptDocument,
  type PromptMetaInput,
  type PromptModel,
  type PromptTaxonomy,
  type PromptVersion,
} from '@/types/promptLibrary';

export const PROMPTS_COLLECTION = 'prompt-library';
export const VERSIONS_SUBCOLLECTION = 'versions';
const META_COLLECTION = 'prompt-library-meta';
const TAXONOMY_DOC = 'taxonomy';

/** Firestore caps a document at 1MiB; this leaves generous room for metadata. */
export const MAX_TEXT_LENGTH = 100_000;
const MAX_TITLE_LENGTH = 160;
const MAX_LABEL_LENGTH = 48;
const MAX_TAGS_PER_PROMPT = 20;
const MAX_CATEGORIES = 200;
const MAX_TAGS = 500;
const MAX_MODELS = 100;

export interface PromptLibrarySnapshot {
  prompts: PromptDocument[];
  taxonomy: PromptTaxonomy;
}

// One in-process cache for the whole library. Every read path (list, search,
// detail) is served from the same snapshot, so a page load costs at most one
// collection read per 60s across all users on this instance. Busted by every
// write path below.
const CACHE_TTL_MS = 60_000;
let cache: { data: PromptLibrarySnapshot; expiresAt: number } | null = null;

export function invalidatePromptLibraryCache(): void {
  cache = null;
}

// ─── Normalisation ───────────────────────────────────────────────────────────

function clampText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function cleanLabel(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL_LENGTH) : '';
}

/** Dedupes case-insensitively while preserving the first spelling seen. */
function dedupeLabels(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const label = cleanLabel(raw);
    if (!label) continue;
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

/** Model ids, deduped and validated. Unknown-but-well-formed ids are kept —
 *  the managed list can lose an entry without orphaning the prompts on it. */
function cleanModelIds(values: unknown): LlmType[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (!isValidModelId(raw) || seen.has(raw)) continue;
    seen.add(raw);
    if (seen.size >= MAX_MODELS_PER_PROMPT) break;
  }
  return Array.from(seen);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function readChange(d: any): ChangeStat | null {
  if (!d || typeof d !== 'object') return null;
  const kind = d.kind;
  if (!['initial', 'tweak', 'edit', 'rewrite'].includes(kind)) return null;
  return {
    added: Number(d.added) || 0,
    removed: Number(d.removed) || 0,
    ratio: Number(d.ratio) || 0,
    region: ['none', 'start', 'middle', 'end', 'throughout'].includes(d.region) ? d.region : 'none',
    kind,
  };
}

function readModels(v: any): PromptModel[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: PromptModel[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id.toLowerCase() : '';
    if (!isValidModelId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: cleanLabel(raw.name) || id,
      logo: null,
      addedAt: Number(raw.addedAt) || 1,
      builtin: false,
    });
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

/**
 * Reads the model list off a head document.
 *
 * `llmTypes` is the current field. Documents written before multi-model support
 * only have the singular `llmType`, so it is the fallback — no migration, no
 * backfill, and a prompt written by an older client still reads correctly.
 */
function readLlmTypes(d: any): LlmType[] {
  const many = cleanModelIds(d?.llmTypes);
  if (many.length > 0) return many;
  return isValidModelId(d?.llmType) ? [d.llmType] : [];
}

function mapPrompt(doc: FirebaseFirestore.QueryDocumentSnapshot): PromptDocument {
  const d = doc.data() ?? {};
  const created = typeof d.createdTime === 'string' ? d.createdTime : new Date(0).toISOString();
  const version = Number(d.version) || 1;
  const llmTypes = readLlmTypes(d);
  return {
    id: doc.id,
    llmTypes: llmTypes.length > 0 ? llmTypes : ['chatgpt'],
    category: typeof d.category === 'string' ? d.category : '',
    title: typeof d.title === 'string' ? d.title : '',
    tags: dedupeLabels(d.tags, MAX_TAGS_PER_PROMPT),
    text: typeof d.text === 'string' ? d.text : '',
    textHtml: sanitizePromptHtml(d.textHtml) || null,
    version,
    versionCount: Number(d.versionCount) || version,
    basedOn: typeof d.basedOn === 'number' ? d.basedOn : null,
    change: readChange(d.change),
    editNote: clampText(d.editNote, MAX_EDIT_NOTE_LENGTH),
    isArchived: d.isArchived === true,
    createdTime: created,
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : '',
    lastUpdatedTime: typeof d.lastUpdatedTime === 'string' ? d.lastUpdatedTime : created,
    lastUpdatedBy: typeof d.lastUpdatedBy === 'string' ? d.lastUpdatedBy : '',
  };
}

function mapVersion(doc: FirebaseFirestore.QueryDocumentSnapshot): PromptVersion {
  const d = doc.data() ?? {};
  return {
    version: Number(d.version) || Number(doc.id) || 1,
    text: typeof d.text === 'string' ? d.text : '',
    textHtml: sanitizePromptHtml(d.textHtml) || null,
    basedOn: typeof d.basedOn === 'number' ? d.basedOn : null,
    change: readChange(d.change),
    editNote: clampText(d.editNote, MAX_EDIT_NOTE_LENGTH),
    createdTime: typeof d.createdTime === 'string' ? d.createdTime : new Date(0).toISOString(),
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : '',
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Resolves a submitted body into the pair that gets stored.
 *
 * When rich markup is supplied the plain text is DERIVED from it rather than
 * taken from the client, so `text` — which copy, search and diff all rely on —
 * can never disagree with what is rendered.
 */
function resolveBody(rawText: unknown, rawHtml: unknown): { text: string; textHtml: string | null } {
  const html = sanitizePromptHtml(rawHtml);
  if (html) {
    const derived = htmlToPlainText(html).slice(0, MAX_TEXT_LENGTH);
    return { text: derived, textHtml: html };
  }
  return { text: clampText(rawText, MAX_TEXT_LENGTH), textHtml: null };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * The library head docs plus the managed taxonomy. Sorted newest-updated first
 * in memory rather than by an `orderBy`, so no composite index is needed.
 */
export async function getPromptLibrary(): Promise<PromptLibrarySnapshot> {
  if (cache && Date.now() < cache.expiresAt) return cache.data;

  const [promptsSnap, taxonomySnap] = await Promise.all([
    adminDb.collection(PROMPTS_COLLECTION).get(),
    adminDb.collection(META_COLLECTION).doc(TAXONOMY_DOC).get(),
  ]);

  const prompts = promptsSnap.docs.map(mapPrompt);
  prompts.sort(
    (a, b) => new Date(b.lastUpdatedTime).getTime() - new Date(a.lastUpdatedTime).getTime()
  );

  const t = taxonomySnap.data();
  const taxonomy: PromptTaxonomy = t
    ? {
        categories: dedupeLabels(t.categories, MAX_CATEGORIES),
        tags: dedupeLabels(t.tags, MAX_TAGS),
        models: readModels(t.models),
      }
    : { ...EMPTY_TAXONOMY };

  const data = { prompts, taxonomy };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

/** Full version history for one prompt, newest first. Never cached in-process —
 *  it is only fetched when a detail card opens, and the client caches it. */
export async function getPromptVersions(id: string): Promise<PromptVersion[] | null> {
  const head = await adminDb.collection(PROMPTS_COLLECTION).doc(id).get();
  if (!head.exists) return null;

  const snap = await head.ref.collection(VERSIONS_SUBCOLLECTION).get();
  return snap.docs.map(mapVersion).sort((a, b) => b.version - a.version);
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function createPrompt(
  input: Partial<PromptCreateInput>,
  uid: string
): Promise<PromptDocument> {
  const now = new Date().toISOString();
  const llmTypes = cleanModelIds(input.llmTypes);
  const { text, textHtml } = resolveBody(input.text, input.textHtml);
  const change: ChangeStat = { added: 0, removed: 0, ratio: 0, region: 'none', kind: 'initial' };

  const doc: Omit<PromptDocument, 'id'> = {
    llmTypes: llmTypes.length > 0 ? llmTypes : ['chatgpt'],
    category: cleanLabel(input.category),
    title: clampText(input.title, MAX_TITLE_LENGTH).trim(),
    tags: dedupeLabels(input.tags, MAX_TAGS_PER_PROMPT),
    text,
    textHtml,
    version: 1,
    versionCount: 1,
    basedOn: null,
    change,
    editNote: '',
    isArchived: false,
    createdTime: now,
    createdBy: uid,
    lastUpdatedTime: now,
    lastUpdatedBy: uid,
  };

  const ref = adminDb.collection(PROMPTS_COLLECTION).doc();
  const batch = adminDb.batch();
  batch.set(ref, {
    ...doc,
    // Still written singular so a renderer running an older bundle — which may
    // be weeks old — keeps resolving this prompt's model (rule 9c).
    llmType: doc.llmTypes[0],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(ref.collection(VERSIONS_SUBCOLLECTION).doc('1'), {
    version: 1,
    text,
    textHtml,
    basedOn: null,
    change,
    editNote: '',
    createdTime: now,
    createdBy: uid,
  });
  await batch.commit();

  // The new labels join the managed taxonomy so they stay offerable even if
  // this prompt is later archived or recategorised.
  await mergeTaxonomy(doc.category ? [doc.category] : [], doc.tags, []);

  invalidatePromptLibraryCache();
  return { id: ref.id, ...doc };
}

export interface AddVersionResult {
  prompt: PromptDocument;
  version: PromptVersion;
}

/**
 * Saves an edit as a NEW version at the head of the history.
 *
 * `basedOn` is the version the editor was actually looking at — which may be an
 * older one. The diff is computed against that version's text, not against the
 * current head, which is what makes "Edited from v2" truthful when someone
 * reaches back and revises an earlier draft.
 */
export async function addPromptVersion(
  id: string,
  rawText: string,
  rawHtml: string | null | undefined,
  rawEditNote: unknown,
  basedOn: number,
  uid: string
): Promise<AddVersionResult | null | 'unchanged'> {
  const headRef = adminDb.collection(PROMPTS_COLLECTION).doc(id);
  const baseRef = headRef.collection(VERSIONS_SUBCOLLECTION).doc(String(basedOn));
  const { text, textHtml } = resolveBody(rawText, rawHtml);
  const editNote = clampText(rawEditNote, MAX_EDIT_NOTE_LENGTH).trim();

  const result = await adminDb.runTransaction(async tx => {
    const [headSnap, baseSnap] = await tx.getAll(headRef, baseRef);
    if (!headSnap.exists || !baseSnap.exists) return null;

    const head = mapPrompt(headSnap as FirebaseFirestore.QueryDocumentSnapshot);
    const base = mapVersion(baseSnap as FirebaseFirestore.QueryDocumentSnapshot);
    // Formatting alone is a real change, so the comparison covers both layers.
    if (base.text === text && (base.textHtml ?? '') === (textHtml ?? '')) {
      return 'unchanged' as const;
    }

    const now = new Date().toISOString();
    const nextVersion = head.versionCount + 1;
    const change = summariseChange(base.text, text);

    const version: PromptVersion = {
      version: nextVersion,
      text,
      textHtml,
      basedOn,
      change,
      editNote,
      createdTime: now,
      createdBy: uid,
    };

    tx.set(headRef.collection(VERSIONS_SUBCOLLECTION).doc(String(nextVersion)), version);
    tx.update(headRef, {
      text,
      textHtml,
      version: nextVersion,
      versionCount: nextVersion,
      basedOn,
      change,
      editNote,
      lastUpdatedTime: now,
      lastUpdatedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      prompt: {
        ...head,
        text,
        textHtml,
        version: nextVersion,
        versionCount: nextVersion,
        basedOn,
        change,
        editNote,
        lastUpdatedTime: now,
        lastUpdatedBy: uid,
      },
      version,
    };
  });

  if (result && result !== 'unchanged') invalidatePromptLibraryCache();
  return result;
}

/** Title / category / tags / models / archive state. Does not cut a version —
 *  the version history is the history of the prompt TEXT. */
export async function updatePromptMeta(
  id: string,
  input: PromptMetaInput,
  uid: string
): Promise<PromptDocument | null> {
  const ref = adminDb.collection(PROMPTS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const current = mapPrompt(snap as FirebaseFirestore.QueryDocumentSnapshot);
  const now = new Date().toISOString();

  const nextModels = input.llmTypes !== undefined ? cleanModelIds(input.llmTypes) : current.llmTypes;

  const next: PromptDocument = {
    ...current,
    llmTypes: nextModels.length > 0 ? nextModels : current.llmTypes,
    category: input.category !== undefined ? cleanLabel(input.category) : current.category,
    title:
      input.title !== undefined
        ? clampText(input.title, MAX_TITLE_LENGTH).trim() || current.title
        : current.title,
    tags: input.tags !== undefined ? dedupeLabels(input.tags, MAX_TAGS_PER_PROMPT) : current.tags,
    isArchived: input.isArchived !== undefined ? input.isArchived === true : current.isArchived,
    lastUpdatedTime: now,
    lastUpdatedBy: uid,
  };

  await ref.update({
    llmTypes: next.llmTypes,
    llmType: next.llmTypes[0],
    category: next.category,
    title: next.title,
    tags: next.tags,
    isArchived: next.isArchived,
    lastUpdatedTime: now,
    lastUpdatedBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await mergeTaxonomy(next.category ? [next.category] : [], next.tags, []);
  invalidatePromptLibraryCache();
  return next;
}

/** Hard delete: the head doc and its whole version history. Admin-only path. */
export async function deletePrompt(id: string): Promise<boolean> {
  const ref = adminDb.collection(PROMPTS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const versions = await ref.collection(VERSIONS_SUBCOLLECTION).get();
  const batch = adminDb.batch();
  for (const v of versions.docs) batch.delete(v.ref);
  batch.delete(ref);
  await batch.commit();

  invalidatePromptLibraryCache();
  return true;
}

// ─── Taxonomy ────────────────────────────────────────────────────────────────

function readTaxonomyDoc(snap: FirebaseFirestore.DocumentSnapshot): PromptTaxonomy {
  if (!snap.exists) return { ...EMPTY_TAXONOMY };
  const d = snap.data() ?? {};
  return {
    categories: dedupeLabels(d.categories, MAX_CATEGORIES),
    tags: dedupeLabels(d.tags, MAX_TAGS),
    models: readModels(d.models),
  };
}

/**
 * Adds labels to the managed lists, skipping the write entirely when every
 * label is already known — which is the common case, so coining a label costs a
 * write but reusing one costs nothing.
 */
export async function mergeTaxonomy(
  categories: string[],
  tags: string[],
  models: { id: string; name: string }[] = []
): Promise<PromptTaxonomy> {
  const ref = adminDb.collection(META_COLLECTION).doc(TAXONOMY_DOC);
  const snap = await ref.get();
  const current = readTaxonomyDoc(snap);

  const known = new Set(current.models.map(m => m.id));
  const addedModels: PromptModel[] = [];
  for (const m of models) {
    const id = typeof m?.id === 'string' ? m.id.toLowerCase() : '';
    if (!isValidModelId(id) || known.has(id)) continue;
    known.add(id);
    addedModels.push({
      id,
      name: cleanLabel(m.name) || id,
      logo: null,
      // Monotonic and never reused, so "most recently added" survives a rename.
      addedAt: Date.now() + addedModels.length,
      builtin: false,
    });
  }

  const next: PromptTaxonomy = {
    categories: dedupeLabels([...current.categories, ...categories], MAX_CATEGORIES),
    tags: dedupeLabels([...current.tags, ...tags], MAX_TAGS),
    models: [...current.models, ...addedModels].slice(0, MAX_MODELS),
  };

  const unchanged =
    next.categories.length === current.categories.length &&
    next.tags.length === current.tags.length &&
    addedModels.length === 0;
  if (unchanged && snap.exists) return current;

  await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  invalidatePromptLibraryCache();
  return next;
}

/** Removes a label from the managed lists. Prompts already carrying it keep it —
 *  the list governs what is offered, not what exists. */
export async function removeTaxonomyLabel(
  kind: 'category' | 'tag' | 'model',
  label: string
): Promise<PromptTaxonomy> {
  const ref = adminDb.collection(META_COLLECTION).doc(TAXONOMY_DOC);
  const snap = await ref.get();
  const current = readTaxonomyDoc(snap);

  const target = cleanLabel(label).toLowerCase();
  const next: PromptTaxonomy =
    kind === 'category'
      ? { ...current, categories: current.categories.filter(c => c.toLowerCase() !== target) }
      : kind === 'tag'
        ? { ...current, tags: current.tags.filter(t => t.toLowerCase() !== target) }
        : { ...current, models: current.models.filter(m => m.id !== target) };

  await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  invalidatePromptLibraryCache();
  return next;
}
