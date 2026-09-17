/**
 * What a coverage revert should do to the shift an offer was assigned to.
 *
 * Its own module because three call sites need the same answer — `cancelOffer`,
 * `unassignOffer` and `revertOccurrenceCoverage` — and because it is a pure
 * decision: given a shift and an account, delete or patch. Keeping it out of
 * the services means it can be tested without Firebase credentials, which for a
 * function whose wrong answer deletes somebody's working day is worth the file.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { ShiftDocument } from '@/types/firestore';

/**
 * Take one account back off the shift an offer was assigned to.
 *
 * **Deleting is gated on `coverageOfferId`, not on the shift being empty.** Now
 * that in-shift cover merges into the agent's own shift, `assignedShiftId` can
 * point at a real rostered shift — and the old "no creators left, delete it"
 * rule would have deleted the agent's actual working day the moment the last
 * account came off it. Only a document coverage itself created is coverage's to
 * remove.
 *
 * The overtime mark is stripped with the account. Leaving it behind would mean a
 * later assignment of the same account to the same shift arrived already marked,
 * quietly unpaid.
 */
export function detachAccountFromShift(
  shift: ShiftDocument,
  creatorId: string,
): { delete: true } | { delete: false; patch: Record<string, unknown> } {
  const remaining = (shift.creatorIds ?? []).filter(id => id !== creatorId);
  const remainingMarks = (shift.overtimeCreatorIds ?? []).filter(id => id !== creatorId);

  const createdByCoverage = Boolean(shift.coverageOfferId);
  if (createdByCoverage && remaining.length === 0) return { delete: true };

  return {
    delete: false,
    patch: {
      creatorIds: remaining,
      overtimeCreatorIds: remainingMarks,
      updatedAt: FieldValue.serverTimestamp(),
    },
  };
}
