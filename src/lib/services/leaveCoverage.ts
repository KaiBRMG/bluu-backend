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
import { createOccurrenceOverride } from './shiftService';
import { toDayKey } from '../salary/salaryDate';
import type { ShiftDocument, CreatorDocument } from '@/types/firestore';

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

  // ── Resolve creator names ──
  // Names, not ids, on the board: an agent decides whether to claim by which
  // account it is. One batched read (rule 9).
  const creatorSnaps = await adminDb.getAll(
    ...creatorIds.map(id => adminDb.collection('creators').doc(id)),
  );
  const creators = creatorIds.map((creatorId, i) => {
    const snap = creatorSnaps[i];
    const data = snap.exists ? (snap.data() as CreatorDocument) : null;
    return { creatorId, creatorName: data?.stageName ?? creatorId };
  });

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
