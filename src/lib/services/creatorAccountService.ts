/**
 * Assignable creator accounts — creators and their sub-accounts, as one list.
 *
 * ## The model
 *
 * A creator (Cole) is an assignable account. So is each of their sub-accounts
 * (Cole (Fansly)). They are **peers for assignment and pay**: one agent can work
 * Cole while another works Cole (Fansly), and each counts as one account toward
 * whoever holds it.
 *
 * ```
 *   creators/{uid}                    → assignable, id = the creator's auth uid
 *     └ creator-subaccounts/{id}      → assignable, id = a Firestore auto-id
 *          parentCreatorId ───────────┘
 * ```
 *
 * ## One id space
 *
 * A creator id is an auth uid; a sub-account id is an auto-id. They cannot
 * collide, so `shifts.creatorIds` holds either kind with no discriminator — and
 * the salary engine, which counts ids, needed no change whatsoever to price a
 * sub-account correctly. `isSubAccount` on the resolved row exists for
 * *display* (grouping, the parent's name), never for arithmetic.
 *
 * ## Avatar inheritance
 *
 * A sub-account with no photo of its own shows its parent's, resolved here on
 * read. Uploading a new photo for Cole therefore updates Cole (Fansly) too,
 * unless that sub-account has been given its own.
 */

import { adminDb } from '../firebase-admin';
import type { CreatorFullDocument, CreatorSubAccountDocument } from '@/types/firestore';

const CREATORS = 'creators';
const SUBACCOUNTS = 'creator-subaccounts';

/** One row of the flat assignable list. */
export interface AssignableAccount {
  /** The id stored in `shifts.creatorIds`. */
  creatorID: string;
  stageName: string;
  photoURL: string | null;
  photoThumb: string | null;
  isArchived: boolean;
  defaultTimezone?: string;
  /** True for a sub-account. Display only — never used to weight pay. */
  isSubAccount: boolean;
  /** The owning creator, for grouping. Null on a creator itself. */
  parentCreatorId: string | null;
  /** The owning creator's name, for a "Cole → Fansly" grouped picker. */
  parentStageName: string | null;
}

/**
 * Every assignable account, creators and sub-accounts together.
 *
 * Two collection reads regardless of how many creators there are — never one
 * read per creator (rule 9). Archived rows are filtered in memory rather than
 * queried out, because `isArchived` is absent on older documents and an
 * inequality filter would drop exactly those.
 */
export async function getAssignableAccounts(): Promise<AssignableAccount[]> {
  const [creatorSnap, subSnap] = await Promise.all([
    adminDb
      .collection(CREATORS)
      .select('creatorID', 'stageName', 'defaultTimezone', 'isArchived', 'photoURL', 'photoThumb')
      .get(),
    adminDb.collection(SUBACCOUNTS).get(),
  ]);

  const creators = new Map<string, AssignableAccount>();
  for (const doc of creatorSnap.docs) {
    const data = doc.data() as Partial<CreatorFullDocument>;
    if (data.isArchived === true) continue;
    creators.set(doc.id, {
      creatorID: (data.creatorID as string) ?? doc.id,
      stageName: (data.stageName as string) ?? doc.id,
      photoURL: data.photoURL ?? null,
      photoThumb: data.photoThumb ?? null,
      isArchived: false,
      defaultTimezone: (data as { defaultTimezone?: string }).defaultTimezone,
      isSubAccount: false,
      parentCreatorId: null,
      parentStageName: null,
    });
  }

  const subAccounts: AssignableAccount[] = [];
  for (const doc of subSnap.docs) {
    const data = doc.data() as CreatorSubAccountDocument;
    if (data.isArchived === true) continue;

    // A sub-account whose parent is archived or gone is not assignable — it
    // would render as an orphan chip nobody can explain.
    const parent = creators.get(data.parentCreatorId);
    if (!parent) continue;

    subAccounts.push({
      creatorID: doc.id,
      stageName: data.stageName || `${parent.stageName} (${data.label})`,
      // Inherit the parent's face unless this account has its own.
      photoURL: data.photoURL ?? parent.photoURL,
      photoThumb: data.photoThumb ?? parent.photoThumb,
      isArchived: false,
      isSubAccount: true,
      parentCreatorId: data.parentCreatorId,
      parentStageName: parent.stageName,
    });
  }

  // Grouped: each creator immediately followed by its own sub-accounts, so the
  // picker reads as a hierarchy even though the list is flat.
  return [...creators.values()]
    .sort((a, b) => a.stageName.localeCompare(b.stageName))
    .flatMap(creator => [
      creator,
      ...subAccounts
        .filter(sub => sub.parentCreatorId === creator.creatorID)
        .sort((a, b) => a.stageName.localeCompare(b.stageName)),
    ]);
}

/** Sub-accounts for one creator, including archived ones (the admin list manages those). */
export async function getSubAccountsForCreator(parentCreatorId: string): Promise<CreatorSubAccountDocument[]> {
  const snap = await adminDb.collection(SUBACCOUNTS).where('parentCreatorId', '==', parentCreatorId).get();
  return snap.docs
    .map(d => d.data() as CreatorSubAccountDocument)
    .sort((a, b) => a.stageName.localeCompare(b.stageName));
}

/**
 * Validate a list of assignable ids against both collections.
 *
 * The shift write path calls this instead of checking `creators` alone — which
 * is what would otherwise reject every sub-account assignment as an unknown
 * creator.
 */
export async function normaliseAccountIds(
  raw: unknown,
  maxAccounts = 20,
): Promise<{ accountIds: string[]; invalid: string[] }> {
  if (raw === undefined || raw === null) return { accountIds: [], invalid: [] };
  if (!Array.isArray(raw)) return { accountIds: [], invalid: ['(not a list)'] };

  const ids = [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))]
    .map(id => id.trim())
    .slice(0, maxAccounts);
  if (ids.length === 0) return { accountIds: [], invalid: [] };

  // One `getAll` per collection rather than per id. An id is valid if it resolves
  // in *either* — the two id spaces are disjoint, so there is no ambiguity.
  const [creatorDocs, subDocs] = await Promise.all([
    adminDb.getAll(...ids.map(id => adminDb.collection(CREATORS).doc(id))),
    adminDb.getAll(...ids.map(id => adminDb.collection(SUBACCOUNTS).doc(id))),
  ]);

  const valid: string[] = [];
  const invalid: string[] = [];

  for (let i = 0; i < ids.length; i++) {
    const creator = creatorDocs[i].exists ? (creatorDocs[i].data() as CreatorFullDocument) : null;
    const sub = subDocs[i].exists ? (subDocs[i].data() as CreatorSubAccountDocument) : null;

    if (creator && creator.isArchived !== true) valid.push(ids[i]);
    else if (sub && sub.isArchived !== true) valid.push(ids[i]);
    else invalid.push(ids[i]);
  }

  return { accountIds: valid.sort(), invalid };
}

/**
 * The overtime subset of an assignment, constrained to it.
 *
 * `overtimeCreatorIds` marks which of a shift's accounts the agent covers
 * *without extra pay*, so the wage tier counts `creatorIds` **minus** this set.
 * That makes it a subtraction from money, which is why it is intersected rather
 * than trusted: an id the client left behind after removing an account from the
 * picker would quietly dock the agent a tier for an account nobody works.
 *
 * Pure — the ids are already validated as part of `accountIds`, so there is no
 * second read (rule 9). Order follows `accountIds` so the stored field is
 * stable between saves.
 */
export function intersectOvertimeIds(accountIds: string[], raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const requested = new Set(raw.filter((id): id is string => typeof id === 'string').map(id => id.trim()));
  return accountIds.filter(id => requested.has(id));
}

/** Resolve ids to display names across both collections. Missing ids fall back to the id. */
export async function resolveAccountNames(accountIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) return names;

  const [creatorDocs, subDocs] = await Promise.all([
    adminDb.getAll(...unique.map(id => adminDb.collection(CREATORS).doc(id))),
    adminDb.getAll(...unique.map(id => adminDb.collection(SUBACCOUNTS).doc(id))),
  ]);

  for (let i = 0; i < unique.length; i++) {
    const creator = creatorDocs[i].exists ? (creatorDocs[i].data() as CreatorFullDocument) : null;
    const sub = subDocs[i].exists ? (subDocs[i].data() as CreatorSubAccountDocument) : null;
    names.set(unique[i], creator?.stageName ?? sub?.stageName ?? unique[i]);
  }

  return names;
}

/** The displayed name for a sub-account. One rule, so the stored name and the picker agree. */
export function subAccountStageName(parentStageName: string, label: string): string {
  return `${parentStageName} (${label.trim()})`;
}
