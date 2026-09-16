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
import { createOccurrenceOverride, getShiftsByUserAndRange } from './shiftService';
import { expandShiftsForWindow, type ExpandedShift } from '../utils/recurrence';
import { serialiseShift } from '../utils/shiftSerialise';
import { matchLeaveToOccurrences, occurrenceKey } from '../utils/leaveMatch';
import { toLocalDateStr } from '../utils/timezone';
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
  /**
   * The occurrence this release actually acted on, resolved against the live
   * roster rather than the pair the request pinned. Persisted onto the leave
   * document by the approve route so a later withdrawal unwinds the same
   * document this released — see `revertOccurrenceCoverage`.
   *
   * `null` when nothing on the roster answers to the request any more.
   */
  resolved: { shiftId: string; occurrenceStart: number } | null;
  /**
   * True when the roster moved the occurrence after the request was submitted
   * (an admin edited the shift while it sat in the queue). Not an error — the
   * release followed it — but the thing an admin should be told, because the
   * accounts that went to the board are not the ones they saw on the request.
   */
  rehomed: boolean;
}

// ─── Resolving what a leave request actually points at ───────────────

/**
 * Find the occurrence a leave request refers to **as the roster stands now**.
 *
 * A request pins `(shiftId, occurrenceStart)` when it is submitted, and every
 * admin edit path in `/api/shifts/[shiftId]` re-homes that occurrence onto a
 * different document while the request waits in the queue:
 *
 * - `saveMode: 'single'` writes a **new override doc** holding the new
 *   `creatorIds`; the root the request named keeps the old ones.
 * - `saveMode: 'future'` truncates the series and creates a **new root** with a
 *   new id; the old root no longer expands that date at all.
 *
 * Reading `shifts/{leave.shiftId}` directly — which this used to do — therefore
 * released the **stale** assignment and tombstoned a document that was no longer
 * on the roster. Both halves of the reported failure: the accounts added in the
 * edit never reached the overtime board, and the shift stayed on the calendar
 * after the leave was approved.
 *
 * So the release reads the roster the way the calendar does — expand, then match
 * — instead of trusting the pinned id. `matchLeaveToOccurrences` is the same
 * tiered matcher the week view and the agent calendar use, so what an admin sees
 * badged and what approval releases cannot disagree.
 *
 * Returns `null` when nothing answers to the request: the shift was deleted
 * outright, or the day is ambiguous enough that the matcher refuses to guess.
 * A null is reported, never papered over — releasing the wrong accounts pays the
 * wrong person.
 */
export async function resolveLiveOccurrence(params: {
  userId: string;
  shiftId: string;
  occurrenceStart: number;
}): Promise<ExpandedShift | null> {
  const { userId, shiftId, occurrenceStart } = params;

  // ±36h around the pinned instant. Wide enough to catch an occurrence whose
  // time an admin moved within the day (and a midnight-spanning shift whose UTC
  // start lands on the neighbouring date), narrow enough that this stays one
  // user's shifts for one day rather than a roster scan.
  const WINDOW_MS = 36 * 60 * 60 * 1000;
  const windowStart = occurrenceStart - WINDOW_MS;
  const windowEnd = occurrenceStart + WINDOW_MS;

  const raw = await getShiftsByUserAndRange(userId, windowStart, windowEnd);
  const expanded = expandShiftsForWindow(
    raw.map(shift => ({
      ...serialiseShift(shift),
      timeWorkedSeconds: null,
      attendanceStatus: null,
    })),
    windowStart,
    windowEnd,
  );

  const matched = matchLeaveToOccurrences([{ shiftId, occurrenceStart, userId }], expanded);
  if (matched.size === 0) return null;

  return expanded.find(o => matched.has(occurrenceKey(o))) ?? null;
}

/**
 * UTC midnight of the occurrence's **local** date — the shape `overrideDate` is
 * stored in, and the shape `expandShiftsForWindow` compares against.
 *
 * The expander reads a tombstone's date as `toLocalDateStr(overrideDate, tz)`,
 * so a tombstone keyed to the UTC date of a 23:00 shift in a UTC- timezone would
 * name the following day and suppress nothing. Taking the date from the
 * expander's own `overrideDate` where it has one keeps the two in step.
 */
function overrideDateFor(occurrence: ExpandedShift): number {
  if (occurrence.overrideDate) {
    const ms = new Date(occurrence.overrideDate).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  const local = toLocalDateStr(occurrence.occurrenceStart, occurrence.userTimezone || 'UTC');
  const [y, m, d] = local.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
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

  // ── Resolve what the request points at *now* ──
  // Not `shifts/{shiftId}`: the pinned id goes stale the moment an admin edits
  // the shift while the request is queued. See `resolveLiveOccurrence`.
  const occurrence = await resolveLiveOccurrence({ userId, shiftId, occurrenceStart });

  if (!occurrence) {
    // Nothing on the roster answers to this request any more — the shift was
    // deleted outright, or the day became ambiguous. Reported, not guessed at.
    return {
      offersCreated: 0,
      creatorNames: [],
      noAssignments: true,
      occurrenceRemoved: false,
      resolved: null,
      rehomed: true,
    };
  }

  const liveShiftId = occurrence.shiftId;
  const liveStart = occurrence.occurrenceStart;
  const occurrenceEnd = occurrence.occurrenceEnd;
  const creatorIds = occurrence.creatorIds ?? [];
  const rehomed = liveShiftId !== shiftId || liveStart !== occurrenceStart;
  const resolved = { shiftId: liveShiftId, occurrenceStart: liveStart };

  // ── Remove the occurrence from the roster ──
  // A recurring series gets a tombstone for that date only; a one-off shift (or
  // an override document, which is what a single-occurrence edit produces) is
  // soft-deleted so the document — and anything referencing it — survives.
  let occurrenceRemoved = false;
  try {
    if (occurrence.isRecurring && !occurrence.seriesId) {
      await createOccurrenceOverride(
        liveShiftId,
        overrideDateFor(occurrence),
        {
          userId,
          startTime: liveStart,
          endTime: occurrenceEnd,
          wallClockStart: occurrence.wallClockStart,
          wallClockEnd: occurrence.wallClockEnd,
          userTimezone: occurrence.userTimezone,
          createdBy: actorUid,
          recurrence: null,
        },
        true,
      );
    } else {
      await adminDb
        .collection('shifts')
        .doc(liveShiftId)
        .update({ isDeleted: true, updatedAt: FieldValue.serverTimestamp() });
    }
    occurrenceRemoved = true;
  } catch (err) {
    console.error('[leaveCoverage] failed to remove occurrence', err);
  }

  if (creatorIds.length === 0) {
    return { offersCreated: 0, creatorNames: [], noAssignments: true, occurrenceRemoved, resolved, rehomed };
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

  // Keyed to the **resolved** occurrence, so the offer ids a withdrawal has to
  // find match the document that was actually released.
  const offers = await createOffersForOccurrence({
    shiftId: liveShiftId,
    occurrenceStart: liveStart,
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
    resolved,
    rehomed,
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
  /**
   * What the release actually acted on, read back off the leave document.
   *
   * The release resolves the pinned pair against the live roster and may land on
   * a different document (see `resolveLiveOccurrence`). Restoring the *pinned*
   * one would un-delete a shift nobody released and leave the released one
   * tombstoned — the agent back on the roster twice, or not at all. Falls back
   * to the pinned pair for leave approved before this was recorded.
   */
  releasedShiftId?: string | null;
  releasedOccurrenceStart?: number | null;
}): Promise<CoverageRevertResult> {
  const { shiftId, occurrenceStart, leaveId } = params;
  const releasedShiftId = params.releasedShiftId ?? shiftId;
  const releasedStart = params.releasedOccurrenceStart ?? occurrenceStart;
  // The board is keyed by the day the release wrote, which is the resolved one.
  const day = toDayKey(releasedStart);

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
      return (
        offer.leaveId === leaveId ||
        (offer.originalShiftId === releasedShiftId && offer.windowStart === releasedStart)
      );
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
  // Against the document the release acted on, not the one the request pinned.
  try {
    const shiftSnap = await adminDb.collection('shifts').doc(releasedShiftId).get();
    if (shiftSnap.exists) {
      const shift = shiftSnap.data() as ShiftDocument;

      if (shift.isRecurring && !shift.seriesId) {
        // The release wrote a tombstone override for that date; removing it is
        // what makes the occurrence expand again. Filtered in memory on
        // `overrideDate` so the query stays the indexed `seriesId` equality.
        //
        // Matched on the **local** date of the released instant, because that is
        // what the release wrote (`overrideDateFor`) — a UTC-date match would
        // miss the tombstone for a late-evening shift in a UTC- timezone and
        // leave the agent off the roster after withdrawing their leave.
        const localDate = toLocalDateStr(releasedStart, shift.userTimezone || 'UTC');
        const [ly, lm, ld] = localDate.split('-').map(Number);
        const occurrenceDateUtcMidnight = Date.UTC(ly, lm - 1, ld);
        const legacyDateUtcMidnight = Date.UTC(
          new Date(releasedStart).getUTCFullYear(),
          new Date(releasedStart).getUTCMonth(),
          new Date(releasedStart).getUTCDate(),
        );
        const overrides = await adminDb.collection('shifts').where('seriesId', '==', releasedShiftId).get();
        for (const doc of overrides.docs) {
          const override = doc.data() as ShiftDocument;
          const overrideMs = override.overrideDate?.toMillis?.();
          if (
            override.isDeleted &&
            (overrideMs === occurrenceDateUtcMidnight || overrideMs === legacyDateUtcMidnight)
          ) {
            await doc.ref.delete();
            result.shiftRestored = true;
          }
        }
      } else if (shift.isDeleted) {
        await adminDb
          .collection('shifts')
          .doc(releasedShiftId)
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
