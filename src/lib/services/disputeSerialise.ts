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
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueCreatorIds.length; i += 30) {
      chunks.push(uniqueCreatorIds.slice(i, i + 30));
    }
    await Promise.all(chunks.map(async chunk => {
      const snap = await adminDb.collection('creators').where('creatorID', 'in', chunk).get();
      for (const doc of snap.docs) {
        creatorMap[doc.data().creatorID] = {
          stageName: doc.data().stageName ?? doc.data().creatorID,
          photoURL: doc.data().photoURL ?? null,
        };
      }
    }));
  }

  return { userMap, creatorMap };
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
