/**
 * Creator-assignment validation for shifts.
 *
 * The assignment is not decoration: its **count** sets the agent's hourly wage
 * tier (`salaryEngine.hourlyRateFor`). An id that does not resolve to a live
 * creator would pay someone for an account nobody works, so every write path
 * goes through here rather than trusting the client's array.
 *
 * Archived creators are rejected too. A shift assigned to an account that no
 * longer exists is a scheduling error worth surfacing at the moment it is made,
 * not one to discover in a payroll dispute.
 */

import { adminDb } from '../firebase-admin';
import type { CreatorDocument } from '@/types/firestore';

/** Practical ceiling — `shift.md` caps an agent at 5 accounts; this catches a malformed payload. */
const MAX_CREATORS_PER_SHIFT = 20;

export interface NormalisedCreators {
  /** Deduplicated, validated, sorted for a stable document. */
  creatorIds: string[];
  /** Ids that did not resolve to a live creator. Non-empty means reject the write. */
  invalid: string[];
}

/**
 * Validate a submitted creator list.
 *
 * `undefined` and `null` both mean "no assignment", which is legal — a shift can
 * be scheduled before anyone decides which accounts it covers. An empty array
 * means the same thing and clears an existing assignment.
 */
export async function normaliseCreatorIds(raw: unknown): Promise<NormalisedCreators> {
  if (raw === undefined || raw === null) return { creatorIds: [], invalid: [] };
  if (!Array.isArray(raw)) return { creatorIds: [], invalid: ['(not a list)'] };

  const ids = [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))]
    .map(id => id.trim())
    .slice(0, MAX_CREATORS_PER_SHIFT);

  if (ids.length === 0) return { creatorIds: [], invalid: [] };

  const snaps = await adminDb.getAll(...ids.map(id => adminDb.collection('creators').doc(id)));

  const valid: string[] = [];
  const invalid: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const snap = snaps[i];
    const data = snap.exists ? (snap.data() as CreatorDocument & { isArchived?: boolean }) : null;
    if (data && data.isArchived !== true) valid.push(ids[i]);
    else invalid.push(ids[i]);
  }

  return { creatorIds: valid.sort(), invalid };
}

/** Resolve ids to display names for a label. Missing creators fall back to the id. */
export async function resolveCreatorNames(creatorIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (creatorIds.length === 0) return names;

  const unique = [...new Set(creatorIds)];
  const snaps = await adminDb.getAll(...unique.map(id => adminDb.collection('creators').doc(id)));
  for (let i = 0; i < unique.length; i++) {
    const snap = snaps[i];
    names.set(unique[i], snap.exists ? ((snap.data() as CreatorDocument).stageName ?? unique[i]) : unique[i]);
  }
  return names;
}
