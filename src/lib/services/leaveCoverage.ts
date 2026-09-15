/**
 * Leave approval → coverage release.
 *
 * The step that used to be an admin's memory: approving leave tombstones the
 * shift occurrence and posts every creator the absent agent was covering to the
 * Available Shifts board.
 *
 * Kept out of the approve route so the route stays readable and so the same
 * release can be triggered by hand when an admin cancels a shift for a reason
 * other than leave.
 */

import { adminDb } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createOffersForOccurrence } from './caCoverageService';
import { resolveAccountNames } from './creatorAccountService';
import { createOccurrenceOverride } from './shiftService';
import { toDayKey } from '../salary/salaryDate';
import type { CaCoverageOfferDocument, ShiftDocument } from '@/types/firestore';

export interface CoverageReleaseResult {
  /** Offers actually posted to the board. */
  offersCreated: number;
  creatorNames: string[];
  /** True when the shift had no creators assigned — nothing could be released. */
  noAssignments: boolean;
  /** True when the occurrence was tombstoned (or already was). */
  occurrenceRemoved: boolean;
}

/**
 * Release one shift occurrence for cover.
 *
 * Returns a report rather than throwing on the "nothing to release" case,
 * because that case is common and benign for a shift created before creator
 * assignment existed — but it is *not* silent: the approval screen surfaces
 * `noAssignments` so an admin knows the board did not get an entry and the
 * accounts are uncovered.
 */
export async function releaseOccurrenceForCoverage(params: {
  shiftId: string;
  occurrenceStart: number;
  userId: string;
  leaveId: string | null;
  actorUid: string;
}): Promise<CoverageReleaseResult> {
  const { shiftId, occurrenceStart, userId, leaveId, actorUid } = params;

  const shiftSnap = await adminDb.collection('shifts').doc(shiftId).get();
  if (!shiftSnap.exists) {
    return { offersCreated: 0, creatorNames: [], noAssignments: true, occurrenceRemoved: false };
  }

  const shift = shiftSnap.data() as ShiftDocument;
  const creatorIds = shift.creatorIds ?? [];

  // The occurrence's real end. A recurring root's stored start/end describe the
  // first occurrence, so the length is taken from it and applied to the date
  // actually being released.
  const durationMs = Math.max(0, shift.endTime.toMillis() - shift.startTime.toMillis());
  const occurrenceEnd = occurrenceStart + durationMs;

  // ── Remove the occurrence from the roster ──
  // A recurring series gets a tombstone for that date only; a one-off shift is
  // soft-deleted so the document (and anything referencing it) survives.
  let occurrenceRemoved = false;
  try {
    if (shift.isRecurring && !shift.seriesId) {
      const occurrenceDateUtcMidnight = Date.UTC(
        new Date(occurrenceStart).getUTCFullYear(),
        new Date(occurrenceStart).getUTCMonth(),
        new Date(occurrenceStart).getUTCDate(),
      );
      await createOccurrenceOverride(
        shiftId,
        occurrenceDateUtcMidnight,
        {
          userId,
          startTime: occurrenceStart,
          endTime: occurrenceEnd,
          wallClockStart: shift.wallClockStart,
          wallClockEnd: shift.wallClockEnd,
          userTimezone: shift.userTimezone,
          createdBy: actorUid,
          recurrence: null,
        },
        true,
      );
    } else {
      await adminDb
        .collection('shifts')
        .doc(shiftId)
        .update({ isDeleted: true, updatedAt: FieldValue.serverTimestamp() });
    }
    occurrenceRemoved = true;
  } catch (err) {
    console.error('[leaveCoverage] failed to remove occurrence', err);
  }

  if (creatorIds.length === 0) {
    return { offersCreated: 0, creatorNames: [], noAssignments: true, occurrenceRemoved };
  }

  // ── Resolve account names ──
  // Names, not ids, on the board: an agent decides whether to claim by which
  // account it is. Resolved across creators *and* sub-accounts, because a shift
  // can be assigned either — a released "Cole (Fansly)" that showed up as a raw
  // id would be unclaimable in practice. Two batched reads (rule 9).
  const names = await resolveAccountNames(creatorIds);
  const creators = creatorIds.map(creatorId => ({
    creatorId,
    creatorName: names.get(creatorId) ?? creatorId,
  }));

  const offers = await createOffersForOccurrence({
    shiftId,
    occurrenceStart,
    occurrenceEnd,
    userId,
    creators,
    leaveId,
    actorUid,
  });

  // NOTE: the other chat agents are deliberately NOT notified yet. Coverage
  // notifications are held back until the subsystem has run in production (see
  // documentation/ca-salary.md §11). Until then the released accounts appear on
  // the calendar for anyone who opens it, and an admin should tell the team.
  return {
    offersCreated: offers.length,
    creatorNames: creators.map(c => c.creatorName),
    noAssignments: false,
    occurrenceRemoved,
  };
}

/** The day key an occurrence belongs to — exported so callers can label a release. */
export function occurrenceDayKey(occurrenceStart: number): string {
  return toDayKey(occurrenceStart);
}

/** Re-exported for callers that need to build a Timestamp without importing firestore. */
export { Timestamp };

// ─── Withdrawal: putting an absence back ─────────────────────────────

export interface CoverageRevertResult {
  /** Offers removed from the board, assigned or not. */
  offersRemoved: number;
  /** Every account that was released for this absence. */
  creatorNames: string[];
  /** Agents who had been assigned cover, and what each of them loses. */
  reverted: Array<{ userId: string; creatorNames: string[] }>;
  /** True when the agent's own shift occurrence is back on the roster. */
  shiftRestored: boolean;
}

/**
 * Undo `releaseOccurrenceForCoverage` — the agent has withdrawn approved leave
 * and is working the shift after all.
 *
 * Three things have to come back, in this order of importance:
 *
 * 1. **The overtime somebody else was assigned goes away**, along with the shift
 *    that pays for it. This is the write that touches money: leaving it behind
 *    would pay two people for the same accounts on the same day.
 * 2. **The offers leave the board**, because there is nothing left to cover.
 *    They are deleted rather than marked `cancelled`: offer ids are derived from
 *    the occurrence, so a second approval of the same leave has to be able to
 *    post them again, and `createOffersForOccurrence` writes with `merge: false`
 *    over whatever is there.
 * 3. **The original shift occurrence is restored**, with the creator assignment
 *    it always carried — the tombstone is removed for a recurring series, the
 *    soft-delete is lifted for a one-off. Nothing ever removed `creatorIds` from
 *    that shift, so restoring the occurrence restores the assignment with it.
 *
 * Returns a report rather than throwing, for the same reason the release does:
 * the withdrawal itself has already been committed, and an agent must not be
 * told their cancellation failed because a board could not be tidied.
 */
export async function revertOccurrenceCoverage(params: {
  shiftId: string;
  occurrenceStart: number;
  leaveId: string;
}): Promise<CoverageRevertResult> {
  const { shiftId, occurrenceStart, leaveId } = params;
  const day = toDayKey(occurrenceStart);

  const result: CoverageRevertResult = {
    offersRemoved: 0,
    creatorNames: [],
    reverted: [],
    shiftRestored: false,
  };

  // ── Find the offers this absence created ──
  // Queried by `day`, which the board already indexes, then filtered on
  // `leaveId` in memory — `leaveId` is index-exempt (rule 9) and a day holds a
  // handful of offers, so buying an index for it would be the wrong trade.
  let offerDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const snap = await adminDb.collection('ca-coverage-offers').where('day', '==', day).get();
    offerDocs = snap.docs.filter(d => {
      const offer = d.data() as CaCoverageOfferDocument;
      return offer.leaveId === leaveId || (offer.originalShiftId === shiftId && offer.windowStart === occurrenceStart);
    });
  } catch (err) {
    console.error('[leaveCoverage] failed to read offers for revert', err);
  }

  // ── Unwind each one ──
  const revertedByUser = new Map<string, string[]>();
  for (const doc of offerDocs) {
    const offer = doc.data() as CaCoverageOfferDocument;
    result.creatorNames.push(offer.creatorName);

    try {
      if (offer.assignedShiftId) {
        const shiftRef = adminDb.collection('shifts').doc(offer.assignedShiftId);
        const shiftSnap = await shiftRef.get();
        if (shiftSnap.exists) {
          const coverShift = shiftSnap.data() as ShiftDocument;
          const remaining = (coverShift.creatorIds ?? []).filter(id => id !== offer.creatorId);
          // One overtime shift can carry several offers (they merge, so that two
          // accounts pay the 2-account rate once). Drop it only with the last.
          if (remaining.length === 0) await shiftRef.delete();
          else await shiftRef.update({ creatorIds: remaining, updatedAt: FieldValue.serverTimestamp() });
        }
      }

      if (offer.assignedTo) {
        const list = revertedByUser.get(offer.assignedTo) ?? [];
        list.push(offer.creatorName);
        revertedByUser.set(offer.assignedTo, list);
      }

      await doc.ref.delete();
      result.offersRemoved += 1;
    } catch (err) {
      console.error('[leaveCoverage] failed to revert offer', offer.offerId, err);
    }
  }

  result.reverted = [...revertedByUser].map(([userId, creatorNames]) => ({ userId, creatorNames }));

  // ── Put the occurrence back ──
  try {
    const shiftSnap = await adminDb.collection('shifts').doc(shiftId).get();
    if (shiftSnap.exists) {
      const shift = shiftSnap.data() as ShiftDocument;

      if (shift.isRecurring && !shift.seriesId) {
        // The release wrote a tombstone override for that date; removing it is
        // what makes the occurrence expand again. Filtered in memory on
        // `overrideDate` so the query stays the indexed `seriesId` equality.
        const occurrenceDateUtcMidnight = Date.UTC(
          new Date(occurrenceStart).getUTCFullYear(),
          new Date(occurrenceStart).getUTCMonth(),
          new Date(occurrenceStart).getUTCDate(),
        );
        const overrides = await adminDb.collection('shifts').where('seriesId', '==', shiftId).get();
        for (const doc of overrides.docs) {
          const override = doc.data() as ShiftDocument;
          if (override.isDeleted && override.overrideDate?.toMillis?.() === occurrenceDateUtcMidnight) {
            await doc.ref.delete();
            result.shiftRestored = true;
          }
        }
      } else if (shift.isDeleted) {
        await adminDb
          .collection('shifts')
          .doc(shiftId)
          .update({ isDeleted: false, updatedAt: FieldValue.serverTimestamp() });
        result.shiftRestored = true;
      } else {
        // Already on the roster — the release never got as far as removing it.
        result.shiftRestored = true;
      }
    }
  } catch (err) {
    console.error('[leaveCoverage] failed to restore occurrence', err);
  }

  return result;
}
