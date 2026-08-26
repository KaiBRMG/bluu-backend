import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { ResourceDocument, ResourceIcon } from '@/types/resource';

export const RESOURCES_COLLECTION = 'app-resources';

/**
 * Fields a client is allowed to write on create/update. `id`, `lastEditedTime`,
 * and audit fields are derived server-side and never trusted from the client.
 */
export interface ResourceInput {
  name: string;
  url: string | null;
  isNotionPage: boolean;
  notionPageUrl: string;
  groups: string[];
  types: string[];
  status: string;
  icon: ResourceIcon | null;
  users: string[];
}

// Small in-process cache to keep repeated reads (apps page + types endpoint)
// off Firestore. Busted by every write path via invalidateResourcesCache().
const CACHE_TTL_MS = 60_000;
let cache: { data: ResourceDocument[]; expiresAt: number } | null = null;

export function invalidateResourcesCache(): void {
  cache = null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normaliseIcon(icon: any): ResourceIcon | null {
  if (!icon || typeof icon !== 'object') return null;
  if (icon.type === 'emoji' && typeof icon.value === 'string') {
    return { type: 'emoji', value: icon.value };
  }
  if (icon.type === 'url' && typeof icon.value === 'string') {
    return { type: 'url', value: icon.value };
  }
  return null;
}

function toStringArray(v: any): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function mapDoc(doc: FirebaseFirestore.DocumentSnapshot): ResourceDocument {
  const d = doc.data() ?? {};
  return {
    id: doc.id,
    name: typeof d.name === 'string' ? d.name : '',
    url: typeof d.url === 'string' && d.url.length > 0 ? d.url : null,
    isNotionPage: d.isNotionPage === true,
    notionPageUrl: typeof d.notionPageUrl === 'string' ? d.notionPageUrl : '',
    groups: toStringArray(d.groups),
    types: toStringArray(d.types),
    status: typeof d.status === 'string' ? d.status : 'Active',
    lastEditedTime:
      typeof d.lastEditedTime === 'string' ? d.lastEditedTime : new Date().toISOString(),
    icon: normaliseIcon(d.icon),
    users: toStringArray(d.users),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Returns every resource, newest-edited first. Cached for 60s. */
export async function getAllResources(): Promise<ResourceDocument[]> {
  if (cache && Date.now() < cache.expiresAt) return cache.data;

  const snap = await adminDb.collection(RESOURCES_COLLECTION).get();
  const docs = snap.docs.map(mapDoc);
  docs.sort(
    (a, b) => new Date(b.lastEditedTime).getTime() - new Date(a.lastEditedTime).getTime()
  );

  cache = { data: docs, expiresAt: Date.now() + CACHE_TTL_MS };
  return docs;
}

/**
 * Outcome of a write that had to load the target first. `forbidden` means the
 * caller may not act on the resource **as it is stored** — the check runs
 * against the live document, never the 60s cache, so a resource that was just
 * re-tagged cannot be written on the strength of a stale group list.
 */
export type ResourceWriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not-found' | 'forbidden' };

/** Authorization predicate run against the stored document before a write. */
export type ResourceAuthorizer = (existing: ResourceDocument) => boolean;

/** Coerce arbitrary client input into a persisted resource payload. */
function sanitiseInput(input: Partial<ResourceInput>): ResourceInput {
  const url =
    typeof input.url === 'string' && input.url.trim().length > 0 ? input.url.trim() : null;
  return {
    name: typeof input.name === 'string' ? input.name.trim() : '',
    url,
    // A row with no external URL is treated as a page reference.
    isNotionPage: input.isNotionPage === true || url === null,
    notionPageUrl: typeof input.notionPageUrl === 'string' ? input.notionPageUrl.trim() : '',
    groups: toStringArray(input.groups),
    types: toStringArray(input.types),
    status: typeof input.status === 'string' && input.status.length > 0 ? input.status : 'Active',
    icon: normaliseIcon(input.icon),
    users: toStringArray(input.users),
  };
}

export async function createResource(input: Partial<ResourceInput>): Promise<ResourceDocument> {
  const clean = sanitiseInput(input);
  const now = new Date().toISOString();
  const ref = adminDb.collection(RESOURCES_COLLECTION).doc();
  await ref.set({
    ...clean,
    lastEditedTime: now,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  invalidateResourcesCache();
  return { id: ref.id, ...clean, lastEditedTime: now };
}

export async function updateResource(
  id: string,
  input: Partial<ResourceInput>,
  authorize?: ResourceAuthorizer
): Promise<ResourceWriteResult<ResourceDocument>> {
  const ref = adminDb.collection(RESOURCES_COLLECTION).doc(id);
  const existing = await ref.get();
  if (!existing.exists) return { ok: false, reason: 'not-found' };
  if (authorize && !authorize(mapDoc(existing))) return { ok: false, reason: 'forbidden' };

  const clean = sanitiseInput({ ...existing.data(), ...input } as Partial<ResourceInput>);
  const now = new Date().toISOString();
  await ref.set(
    { ...clean, lastEditedTime: now, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  invalidateResourcesCache();
  return { ok: true, value: { id, ...clean, lastEditedTime: now } };
}

export async function deleteResource(
  id: string,
  authorize?: ResourceAuthorizer
): Promise<ResourceWriteResult<true>> {
  const ref = adminDb.collection(RESOURCES_COLLECTION).doc(id);
  const existing = await ref.get();
  if (!existing.exists) return { ok: false, reason: 'not-found' };
  if (authorize && !authorize(mapDoc(existing))) return { ok: false, reason: 'forbidden' };
  await ref.delete();
  invalidateResourcesCache();
  return { ok: true, value: true };
}
