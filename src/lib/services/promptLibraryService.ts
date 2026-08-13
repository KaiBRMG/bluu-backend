import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { summariseChange } from '@/lib/promptDiff';
import {
  isLlmType,
  EMPTY_TAXONOMY,
  type ChangeStat,
  type LlmType,
  type PromptCreateInput,
  type PromptDocument,
  type PromptMetaInput,
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

function mapPrompt(doc: FirebaseFirestore.QueryDocumentSnapshot): PromptDocument {
  const d = doc.data() ?? {};
  const created = typeof d.createdTime === 'string' ? d.createdTime : new Date(0).toISOString();
  const version = Number(d.version) || 1;
  return {
    id: doc.id,
    llmType: isLlmType(d.llmType) ? d.llmType : 'chatgpt',
    category: typeof d.category === 'string' ? d.category : '',
    title: typeof d.title === 'string' ? d.title : '',
    tags: dedupeLabels(d.tags, MAX_TAGS_PER_PROMPT),
    text: typeof d.text === 'string' ? d.text : '',
    version,
    versionCount: Number(d.versionCount) || version,
    basedOn: typeof d.basedOn === 'number' ? d.basedOn : null,
    change: readChange(d.change),
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
    basedOn: typeof d.basedOn === 'number' ? d.basedOn : null,
    change: readChange(d.change),
    createdTime: typeof d.createdTime === 'string' ? d.createdTime : new Date(0).toISOString(),
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : '',
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  const llmType: LlmType = isLlmType(input.llmType) ? input.llmType : 'chatgpt';
  const text = clampText(input.text, MAX_TEXT_LENGTH);
  const change: ChangeStat = { added: 0, removed: 0, ratio: 0, region: 'none', kind: 'initial' };

  const doc: Omit<PromptDocument, 'id'> = {
    llmType,
    category: cleanLabel(input.category),
    title: clampText(input.title, MAX_TITLE_LENGTH).trim(),
    tags: dedupeLabels(input.tags, MAX_TAGS_PER_PROMPT),
    text,
    version: 1,
    versionCount: 1,
    basedOn: null,
    change,
    isArchived: false,
    createdTime: now,
    createdBy: uid,
    lastUpdatedTime: now,
    lastUpdatedBy: uid,
  };

  const ref = adminDb.collection(PROMPTS_COLLECTION).doc();
  const batch = adminDb.batch();
  batch.set(ref, { ...doc, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  batch.set(ref.collection(VERSIONS_SUBCOLLECTION).doc('1'), {
    version: 1,
    text,
    basedOn: null,
    change,
    createdTime: now,
    createdBy: uid,
  });
  await batch.commit();

  // The new labels join the managed taxonomy so they stay offerable even if
  // this prompt is later archived or recategorised.
  await mergeTaxonomy(doc.category ? [doc.category] : [], doc.tags);

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
  basedOn: number,
  uid: string
): Promise<AddVersionResult | null | 'unchanged'> {
  const headRef = adminDb.collection(PROMPTS_COLLECTION).doc(id);
  const baseRef = headRef.collection(VERSIONS_SUBCOLLECTION).doc(String(basedOn));
  const text = clampText(rawText, MAX_TEXT_LENGTH);

  const result = await adminDb.runTransaction(async tx => {
    const [headSnap, baseSnap] = await tx.getAll(headRef, baseRef);
    if (!headSnap.exists || !baseSnap.exists) return null;

    const head = mapPrompt(headSnap as FirebaseFirestore.QueryDocumentSnapshot);
    const baseText = mapVersion(baseSnap as FirebaseFirestore.QueryDocumentSnapshot).text;
    if (baseText === text) return 'unchanged' as const;

    const now = new Date().toISOString();
    const nextVersion = head.versionCount + 1;
    const change = summariseChange(baseText, text);

    const version: PromptVersion = {
      version: nextVersion,
      text,
      basedOn,
      change,
      createdTime: now,
      createdBy: uid,
    };

    tx.set(headRef.collection(VERSIONS_SUBCOLLECTION).doc(String(nextVersion)), version);
    tx.update(headRef, {
      text,
      version: nextVersion,
      versionCount: nextVersion,
      basedOn,
      change,
      lastUpdatedTime: now,
      lastUpdatedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      prompt: {
        ...head,
        text,
        version: nextVersion,
        versionCount: nextVersion,
        basedOn,
        change,
        lastUpdatedTime: now,
        lastUpdatedBy: uid,
      },
      version,
    };
  });

  if (result && result !== 'unchanged') invalidatePromptLibraryCache();
  return result;
}

/** Title / category / tags / LLM / archive state. Does not cut a version — the
 *  version history is the history of the prompt TEXT. */
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

  const next: PromptDocument = {
    ...current,
    llmType: isLlmType(input.llmType) ? input.llmType : current.llmType,
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
    llmType: next.llmType,
    category: next.category,
    title: next.title,
    tags: next.tags,
    isArchived: next.isArchived,
    lastUpdatedTime: now,
    lastUpdatedBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await mergeTaxonomy(next.category ? [next.category] : [], next.tags);
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

/**
 * Adds labels to the managed lists, skipping the write entirely when every
 * label is already known — which is the common case, so coining a label costs a
 * write but reusing one costs nothing.
 */
export async function mergeTaxonomy(
  categories: string[],
  tags: string[]
): Promise<PromptTaxonomy> {
  const ref = adminDb.collection(META_COLLECTION).doc(TAXONOMY_DOC);
  const snap = await ref.get();
  const current: PromptTaxonomy = snap.exists
    ? {
        categories: dedupeLabels(snap.data()?.categories, MAX_CATEGORIES),
        tags: dedupeLabels(snap.data()?.tags, MAX_TAGS),
      }
    : { ...EMPTY_TAXONOMY };

  const next: PromptTaxonomy = {
    categories: dedupeLabels([...current.categories, ...categories], MAX_CATEGORIES),
    tags: dedupeLabels([...current.tags, ...tags], MAX_TAGS),
  };

  const unchanged =
    next.categories.length === current.categories.length &&
    next.tags.length === current.tags.length;
  if (unchanged && snap.exists) return current;

  await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  invalidatePromptLibraryCache();
  return next;
}

/** Removes a label from the managed lists. Prompts already carrying it keep it —
 *  the list governs what is offered, not what exists. */
export async function removeTaxonomyLabel(
  kind: 'category' | 'tag',
  label: string
): Promise<PromptTaxonomy> {
  const ref = adminDb.collection(META_COLLECTION).doc(TAXONOMY_DOC);
  const snap = await ref.get();
  const current: PromptTaxonomy = snap.exists
    ? {
        categories: dedupeLabels(snap.data()?.categories, MAX_CATEGORIES),
        tags: dedupeLabels(snap.data()?.tags, MAX_TAGS),
      }
    : { ...EMPTY_TAXONOMY };

  const target = cleanLabel(label).toLowerCase();
  const next: PromptTaxonomy =
    kind === 'category'
      ? { ...current, categories: current.categories.filter(c => c.toLowerCase() !== target) }
      : { ...current, tags: current.tags.filter(t => t.toLowerCase() !== target) };

  await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  invalidatePromptLibraryCache();
  return next;
}
