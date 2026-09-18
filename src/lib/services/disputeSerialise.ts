/**
 * Turning raw `disputes` documents into the shape every dispute surface reads.
 *
 * This lives here rather than inside `api/disputes/route.ts` because App Router
 * refuses non-route exports from a `route.ts`, and two endpoints now need the
 * identical projection: the paginated list and the dashboard summary. Two
 * copies of `serialiseDispute` is how one surface quietly starts rendering a
 * raw uid where the other renders a name.
 *
 * ## Read budget
 *
 * `resolveNames` is the whole reason a dispute list is not an N+1: the names
 * and photos of every person and creator across a page of disputes are fetched
 * in one `getAll` and one chunked `in` query, never one lookup per row
 * (CLAUDE.md rule 9).
 */

import { adminDb } from '../firebase-admin';
import { DocumentData } from 'firebase-admin/firestore';
import { serializeTimestamp } from '../middleware/apiHelpers';
import type { DisputeDocument } from '@/types/firestore';

export interface UserInfo { displayName: string; photoURL: string | null; }
export interface CreatorInfo { stageName: string; photoURL: string | null; }

export interface NameMaps {
  userMap: Record<string, UserInfo>;
  creatorMap: Record<string, CreatorInfo>;
}

export function serialiseDispute(
  id: string,
  data: DocumentData,
  userMap: Record<string, UserInfo>,
  creatorMap: Record<string, CreatorInfo>,
): DisputeDocument {
  // Empty displayName signals a deleted user — the client renders an italic
  // "Deleted User" label in place of the (now meaningless) raw UID.
  const assignedToInfo = data.assignedTo === 'No One'
    ? { displayName: 'No One', photoURL: null }
    : (userMap[data.assignedTo] ?? { displayName: '', photoURL: null });
  const createdByInfo = userMap[data.createdBy] ?? { displayName: '', photoURL: null };
  const creatorInfo = creatorMap[data.Creator];
  return {
    id,
    createdAt: serializeTimestamp(data.createdAt),
    saleDate: serializeTimestamp(data.saleDate),
    // Absent on every dispute decided before this field existed. The dashboard
    // treats "no resolvedAt" as "not decided recently" rather than as "decided
    // at the epoch", which is the only reading that does not resurface a
    // two-year-old verdict as news.
    resolvedAt: serializeTimestamp(data.resolvedAt),
    assignedTo: data.assignedTo,
    assignedToName: assignedToInfo.displayName,
    assignedToPhotoURL: assignedToInfo.photoURL,
    CaApproval: data.CaApproval,
    AdminApproval: data.AdminApproval,
    Creator: data.Creator,
    creatorName: creatorInfo?.stageName ?? data.Creator,
    creatorPhotoURL: creatorInfo?.photoURL ?? null,
    saleAmount: data.saleAmount,
    fanName: data.fanName,
    Comment: data.Comment,
    createdBy: data.createdBy,
    createdByName: createdByInfo.displayName,
    createdByPhotoURL: createdByInfo.photoURL,
  };
}

export async function resolveNames(
  ids: { createdBy: string; assignedTo: string; Creator: string }[],
): Promise<NameMaps> {
  // Batch-fetch all unique user docs in one round-trip
  const uniqueUids = [...new Set([
    ...ids.map(d => d.createdBy),
    ...ids.filter(d => d.assignedTo !== 'No One').map(d => d.assignedTo),
  ])].filter(Boolean);
  const userMap: Record<string, UserInfo> = {};
  if (uniqueUids.length > 0) {
    const userRefs = uniqueUids.map(uid => adminDb.collection('users').doc(uid));
    const userDocs = await adminDb.getAll(...userRefs);
    for (const doc of userDocs) {
      if (doc.exists) {
        userMap[doc.id] = {
          displayName: doc.data()?.displayName ?? doc.id,
          photoURL: doc.data()?.photoURL ?? null,
        };
      }
    }
  }

  // Batch-fetch creator names + photos via 'in' query (max 30 per Firestore limit)
  const uniqueCreatorIds = [...new Set(ids.map(d => d.Creator).filter(Boolean))];
  const creatorMap: Record<string, CreatorInfo> = {};
  if (uniqueCreatorIds.length > 0) {
    const chunks = chunk30(uniqueCreatorIds);
    await Promise.all(chunks.map(async ids30 => {
      const snap = await adminDb.collection('creators').where('creatorID', 'in', ids30).get();
      for (const doc of snap.docs) {
        creatorMap[doc.data().creatorID] = {
          stageName: doc.data().stageName ?? doc.data().creatorID,
          photoURL: doc.data().photoURL ?? null,
        };
      }
    }));

    await resolveSubAccounts(uniqueCreatorIds, creatorMap);
  }

  return { userMap, creatorMap };
}

function chunk30(values: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < values.length; i += 30) out.push(values.slice(i, i + 30));
  return out;
}

/**
 * Resolve the ids the `creators` query could not — they are sub-accounts.
 *
 * **A creator's sub-account is an assignable peer, not a child** (CLAUDE.md
 * rule 9h): a shift can name one, a sale can land on one, and a dispute's
 * `Creator` is therefore sometimes a `creator-subaccounts` auto-id. Those ids
 * live in a disjoint space from `creators.creatorID`, so the equality query
 * above can never match one — and `serialiseDispute`'s `?? data.Creator`
 * fallback then rendered the raw document id on the row. Which is exactly what
 * it looked like: `YF7WLhnq7aRXJqUsMHKN` where a stage name belonged.
 *
 * Only the leftovers are looked up, and by **document id**, so the cost is one
 * `getAll` over the handful of ids that actually missed rather than a second
 * scan of the roster. A sub-account with no photo of its own inherits the
 * parent's, resolved the same way `getAssignableAccounts` does it — otherwise a
 * face that exists everywhere else in the app drops to initials here.
 */
async function resolveSubAccounts(
  creatorIds: string[],
  creatorMap: Record<string, CreatorInfo>,
): Promise<void> {
  const unresolved = creatorIds.filter(id => !creatorMap[id]);
  if (unresolved.length === 0) return;

  const subDocs = await adminDb.getAll(
    ...unresolved.map(id => adminDb.collection('creator-subaccounts').doc(id)),
  );

  // { subAccountId -> its doc }, plus the parents whose photo we may still need.
  const subs: { id: string; stageName: string; photoURL: string | null; parentId: string }[] = [];
  const parentsNeeded = new Set<string>();

  for (const doc of subDocs) {
    if (!doc.exists) continue;
    const data = doc.data()!;
    const parentId = typeof data.parentCreatorId === 'string' ? data.parentCreatorId : '';
    const photoURL = (data.photoURL as string | undefined) ?? null;
    subs.push({
      id: doc.id,
      // `stageName` is derived from the parent + label at write time, so it is
      // normally present; the label form is the fallback for an older doc.
      stageName: (data.stageName as string) || `${data.label ?? 'Sub-account'}`,
      photoURL,
      parentId,
    });
    if (!photoURL && parentId && !creatorMap[parentId]) parentsNeeded.add(parentId);
  }

  if (parentsNeeded.size > 0) {
    await Promise.all(chunk30([...parentsNeeded]).map(async ids30 => {
      const snap = await adminDb.collection('creators').where('creatorID', 'in', ids30).get();
      for (const doc of snap.docs) {
        // Cached into the same map: a payload that names both a parent and its
        // sub-account then costs one lookup, not two.
        creatorMap[doc.data().creatorID] = {
          stageName: doc.data().stageName ?? doc.data().creatorID,
          photoURL: doc.data().photoURL ?? null,
        };
      }
    }));
  }

  for (const sub of subs) {
    creatorMap[sub.id] = {
      stageName: sub.stageName,
      photoURL: sub.photoURL ?? creatorMap[sub.parentId]?.photoURL ?? null,
    };
  }
}

/** Newest first, by `createdAt`. Applied in memory — see `route.ts`. */
export function byNewest(a: DocumentData, b: DocumentData): number {
  const aMs = a.createdAt?.toMillis?.() ?? 0;
  const bMs = b.createdAt?.toMillis?.() ?? 0;
  return bMs - aMs;
}

/**
 * Serialise a set of raw docs in one pass, resolving every name with one
 * batched lookup for the whole set.
 */
export async function serialiseDisputes(
  docs: (DocumentData & { _id: string })[],
): Promise<DisputeDocument[]> {
  if (docs.length === 0) return [];
  const { userMap, creatorMap } = await resolveNames(
    docs.map(d => ({ createdBy: d.createdBy, assignedTo: d.assignedTo, Creator: d.Creator })),
  );
  return docs.map(d => serialiseDispute(d._id, d, userMap, creatorMap));
}
