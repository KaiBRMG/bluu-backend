/**
 * Coverage — the overtime marketplace.
 *
 * One pipeline, four states:
 *
 * ```
 *   leave approved ─→ occurrence tombstoned ─→ one offer per released creator
 *                                                      │
 *                            agent claims ─────────────┤  (first-come, many claimants)
 *                                                      ▼
 *                            admin assigns ─→ overtime shift created ─→ offer assigned
 * ```
 *
 * An offer is **one creator on one date**, not one shift, so two agents can
 * split an absence — which is how a four-account absence actually gets covered.
 *
 * ## The two kinds of overtime, and why the wage differs
 *
 * Covering an account *inside* your own shift costs you no extra time, so it
 * pays no extra wage: the assignment is recorded as a shift with `paysWage:
 * false`, which the salary engine excludes from both payable hours and the
 * account count that sets the rate. You keep the sales, which arrive attributed
 * to you in the next sales import regardless.
 *
 * Covering *outside* your shift is real additional time, so it creates a real
 * shift that pays hours at the rate its own account count earns. Assigning a
 * second account to the same window merges into that shift rather than creating
 * a second one — two one-account shifts would pay the 1-account rate twice
 * instead of the 2-account rate once, which is both wrong and worse for the
 * agent.
 */

import { adminDb } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { toDayKey, dayKeyRange, type SalaryDayKey } from '../salary/salaryDate';
import { splitShiftAccounts } from '../salary/shiftAccounts';
import type { CaCoverageOfferDocument, ShiftDocument } from '@/types/firestore';
import { safeTimezone } from '../utils/timezone';

const OFFERS = 'ca-coverage-offers';
const SHIFTS = 'shifts';

export interface CoverageOffer {
  offerId: string;
  day: SalaryDayKey;
  creatorId: string;
  creatorName: string;
  originalUserId: string;
  originalShiftId: string;
  windowStart: number;
  windowEnd: number;
  status: 'available' | 'assigned' | 'cancelled';
  claims: Array<{ userId: string; claimedAt: string; note?: string }>;
  assignedTo: string | null;
  assignedShiftId: string | null;
  assignedInShift: boolean;
  leaveId: string | null;
  createdAt: string | null;
}

function serialiseOffer(doc: CaCoverageOfferDocument): CoverageOffer {
  const claims = Object.entries(doc.claims ?? {})
    .map(([userId, claim]) => ({
      userId,
      claimedAt: claim.claimedAt?.toDate?.()?.toISOString() ?? new Date(0).toISOString(),
      note: claim.note,
    }))
    // Ascending, so the UI can show who got there first without re-sorting.
    .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt));

  return {
    offerId: doc.offerId,
    day: doc.day,
    creatorId: doc.creatorId,
    creatorName: doc.creatorName,
    originalUserId: doc.originalUserId,
    originalShiftId: doc.originalShiftId,
    windowStart: doc.windowStart,
    windowEnd: doc.windowEnd,
    status: doc.status,
    claims,
    assignedTo: doc.assignedTo ?? null,
    assignedShiftId: doc.assignedShiftId ?? null,
    assignedInShift: doc.assignedInShift ?? false,
    leaveId: doc.leaveId ?? null,
    createdAt: doc.createdAt?.toDate?.()?.toISOString() ?? null,
  };
}

// ─── Creation ────────────────────────────────────────────────────────

/**
 * Turn a released shift occurrence into one offer per assigned creator.
 *
 * Called when an admin approves leave. Returns an empty list when the shift had
 * no creators assigned — which is not an error but *is* worth surfacing: it
 * means nobody knows which accounts just went uncovered, and the approval screen
 * says so rather than reporting a silent success.
 *
 * Idempotent by construction: offer ids are derived from the occurrence and the
 * creator, so approving twice rewrites the same documents instead of listing the
 * same account twice on the board.
 */
export async function createOffersForOccurrence(params: {
  shiftId: string;
  occurrenceStart: number;
  occurrenceEnd: number;
  userId: string;
  creators: Array<{ creatorId: string; creatorName: string }>;
  leaveId: string | null;
  actorUid: string;
}): Promise<CoverageOffer[]> {
  const { shiftId, occurrenceStart, occurrenceEnd, userId, creators, leaveId, actorUid } = params;
  if (creators.length === 0) return [];

  const day = toDayKey(occurrenceStart);
  const batch = adminDb.batch();
  const created: CoverageOffer[] = [];

  for (const creator of creators) {
    const offerId = `${shiftId}_${occurrenceStart}_${creator.creatorId}`;
    const ref = adminDb.collection(OFFERS).doc(offerId);

    const doc = {
      offerId,
      day,
      creatorId: creator.creatorId,
      creatorName: creator.creatorName,
      originalUserId: userId,
      originalShiftId: shiftId,
      windowStart: occurrenceStart,
      windowEnd: occurrenceEnd,
      status: 'available' as const,
      claims: {},
      assignedTo: null,
      assignedShiftId: null,
      assignedInShift: false,
      createdBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      leaveId,
    };

    // `create`-like semantics without the throw: an offer already assigned must
    // not be reset to available by a second approval of the same leave.
    batch.set(ref, doc, { merge: false });

    created.push({
      offerId,
      day,
      creatorId: creator.creatorId,
      creatorName: creator.creatorName,
      originalUserId: userId,
      originalShiftId: shiftId,
      windowStart: occurrenceStart,
      windowEnd: occurrenceEnd,
      status: 'available',
      claims: [],
      assignedTo: null,
      assignedShiftId: null,
      assignedInShift: false,
      leaveId,
      createdAt: null,
    });
  }

  await batch.commit();
  return created;
}

// ─── Reads ───────────────────────────────────────────────────────────

/** Offers within a date range, newest day first. `status` narrows the board from the history. */
export async function getOffers(params: {
  fromDay: SalaryDayKey;
  toDay: SalaryDayKey;
  status?: CoverageOffer['status'];
}): Promise<CoverageOffer[]> {
  let query = adminDb
    .collection(OFFERS)
    .where('day', '>=', params.fromDay)
    .where('day', '<=', params.toDay);

  if (params.status) query = query.where('status', '==', params.status);

  const snap = await query.get();
  return snap.docs
    .map(d => serialiseOffer(d.data() as CaCoverageOfferDocument))
    .sort((a, b) => a.day.localeCompare(b.day) || a.creatorName.localeCompare(b.creatorName));
}

export async function getOffer(offerId: string): Promise<CoverageOffer | null> {
  const snap = await adminDb.collection(OFFERS).doc(offerId).get();
  return snap.exists ? serialiseOffer(snap.data() as CaCoverageOfferDocument) : null;
}

// ─── Claims ──────────────────────────────────────────────────────────

/**
 * Register an agent's interest in an offer.
 *
 * Claims accumulate rather than locking the offer, because the admin makes the
 * final call — a lock would let the fastest clicker take an account they are not
 * the right cover for. A transaction guards the read-modify-write so two agents
 * claiming in the same second cannot erase each other.
 */
export async function claimOffer(offerId: string, userId: string, note?: string): Promise<void> {
  await adminDb.runTransaction(async tx => {
    const ref = adminDb.collection(OFFERS).doc(offerId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('This shift is no longer listed.');

    const doc = snap.data() as CaCoverageOfferDocument;
    if (doc.status !== 'available') throw new Error('This shift has already been assigned.');

    tx.update(ref, {
      [`claims.${userId}`]: { claimedAt: Timestamp.now(), ...(note ? { note } : {}) },
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function withdrawClaim(offerId: string, userId: string): Promise<void> {
  await adminDb.collection(OFFERS).doc(offerId).update({
    [`claims.${userId}`]: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ─── Assignment ──────────────────────────────────────────────────────

/**
 * Is this shift an overtime shift?
 *
 * **Two documents can mean it**, and both must answer yes here or the same
 * situation pays two different amounts depending on which screen created it:
 *
 * - `isOvertime: true` — created from a coverage offer. The flag means
 *   "came from an offer", which is why it cannot be the whole test.
 * - **Every assigned account marked overtime** — built by hand in Shift
 *   Management, where there is no offer to point at. `splitShiftAccounts` is
 *   the same function the salary engine prices it with, so "what the engine
 *   pays" and "what the assigner does" are read from one definition.
 *
 * A zero-wage in-shift cover shift is excluded by its caller, not here: it is
 * overtime, but it is not something another account can be merged into.
 */
function isOvertimeShift(shift: ShiftDocument): boolean {
  if (shift.isOvertime) return true;
  return splitShiftAccounts(shift.creatorIds, shift.overtimeCreatorIds).isFullyOvertime;
}

/**
 * Does this agent already have a shift covering the offer's window?
 *
 * Decides in-shift versus outside-shift automatically so the admin is not asked
 * to work it out from two calendars. "Covering" means the agent's shift contains
 * the *whole* offer window — a partial overlap is genuinely extra time and pays
 * as overtime.
 */
export async function findCoveringShift(
  userId: string,
  windowStart: number,
  windowEnd: number,
): Promise<ShiftDocument | null> {
  const [dayStart, dayEnd] = dayKeyRange(toDayKey(windowStart));
  const snap = await adminDb
    .collection(SHIFTS)
    .where('userId', '==', userId)
    .where('startTime', '>=', Timestamp.fromMillis(dayStart - 12 * 3_600_000))
    .where('startTime', '<=', Timestamp.fromMillis(dayEnd))
    .get();

  for (const doc of snap.docs) {
    const shift = doc.data() as ShiftDocument;
    if (shift.isDeleted) continue;
    // An overtime shift is never a "covering" shift — an account added to one
    // merges into it and raises its rate, rather than riding along unpaid. That
    // is `findOvertimeShift`'s job, and the two use the same containment test,
    // so every overtime shift this skips is one that function can still find.
    if (isOvertimeShift(shift)) continue;
    const start = shift.startTime.toMillis();
    const end = shift.endTime.toMillis();
    if (start <= windowStart && end >= windowEnd) return shift;
  }
  return null;
}

export interface AssignResult {
  shiftId: string;
  inShift: boolean;
  /** True when the creator joined an overtime shift that already existed. */
  merged: boolean;
}

/**
 * Assign an offer to an agent, creating or extending the shift that pays for it.
 *
 * `inShift` is resolved from the roster unless the caller forces it, so the
 * common case needs no judgement call. Forcing it is there for the case the
 * calendar cannot see — an agent who agrees to stay on past their shift end.
 */
export async function assignOffer(params: {
  offerId: string;
  userId: string;
  actorUid: string;
  userTimezone: string;
  /** Overrides the automatic in-shift/outside-shift decision. */
  forceInShift?: boolean;
  /** Overtime window, when it differs from the released shift's own hours. */
  windowStart?: number;
  windowEnd?: number;
}): Promise<AssignResult> {
  const { offerId, userId, actorUid, userTimezone, forceInShift } = params;

  const offerSnap = await adminDb.collection(OFFERS).doc(offerId).get();
  if (!offerSnap.exists) throw new Error('Offer not found.');
  const offer = offerSnap.data() as CaCoverageOfferDocument;
  if (offer.status === 'assigned') throw new Error('This offer is already assigned.');

  const windowStart = params.windowStart ?? offer.windowStart;
  const windowEnd = params.windowEnd ?? offer.windowEnd;

  const covering = forceInShift === undefined ? await findCoveringShift(userId, windowStart, windowEnd) : null;
  const inShift = forceInShift ?? covering !== null;

  // An outside-shift assignment merges into an overtime shift the agent already
  // has for the same window, so covering two accounts pays the 2-account rate
  // once rather than the 1-account rate twice.
  let shiftId: string;
  let merged = false;

  if (!inShift) {
    const existing = await findOvertimeShift(userId, windowStart, windowEnd);
    if (existing) {
      shiftId = existing.shiftId;
      merged = true;

      // The invariant being preserved is "an overtime shift pays on all of its
      // accounts", and the two kinds of overtime shift express that in opposite
      // ways — one marks none of its accounts, the other marks all of them. So
      // the new account has to join whichever side the shift already sits on:
      //
      //   board-built (no marks)  → creatorIds only; it stays all-regular
      //   hand-built (all marked) → both; it stays fully-overtime
      //
      // Adding to `creatorIds` alone on a hand-built shift would make it
      // *mixed*, which silently stops its original accounts counting toward the
      // rate — the agent would lose money by being given more work.
      const staysFullyOvertime = splitShiftAccounts(
        existing.creatorIds,
        existing.overtimeCreatorIds,
      ).isFullyOvertime;

      await adminDb
        .collection(SHIFTS)
        .doc(shiftId)
        .update({
          creatorIds: FieldValue.arrayUnion(offer.creatorId),
          ...(staysFullyOvertime && { overtimeCreatorIds: FieldValue.arrayUnion(offer.creatorId) }),
          updatedAt: FieldValue.serverTimestamp(),
        });
    } else {
      shiftId = await createCoverageShift({
        userId,
        windowStart,
        windowEnd,
        creatorId: offer.creatorId,
        userTimezone,
        actorUid,
        offerId,
        paysWage: true,
      });
    }
  } else {
    // In-shift cover is recorded as its own zero-wage shift rather than by
    // appending the creator to the agent's real shift: appending would raise
    // that shift's account count and therefore its hourly rate, which is
    // precisely the wage increase this case must not produce.
    shiftId = await createCoverageShift({
      userId,
      windowStart,
      windowEnd,
      creatorId: offer.creatorId,
      userTimezone,
      actorUid,
      offerId,
      paysWage: false,
    });
  }

  await adminDb.collection(OFFERS).doc(offerId).update({
    status: 'assigned',
    assignedTo: userId,
    assignedShiftId: shiftId,
    assignedInShift: inShift,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { shiftId, inShift, merged };
}

/**
 * An overtime shift this agent already has that the offer's window belongs to.
 *
 * **Exact window first, then containment.** Exact-match-only was enough while
 * the only overtime shifts were board-created ones, which are minted from an
 * offer's own window and so match exactly. A shift an admin built by hand in
 * Shift Management almost never does — 18:00–22:00 against an offer released
 * from someone else's 19:00–23:00 — and missing it would create a *second*
 * paid shift overlapping the first, billing the agent's employer twice for the
 * same hours and paying two low rates instead of one correct one.
 *
 * Containment is the safe widening: the agent is already scheduled for the
 * whole offer window, so the account joins that shift and the shift keeps its
 * own hours. A *partial* overlap is deliberately not matched — that is genuinely
 * extra time, and merging would swallow the hours outside the shift.
 */
async function findOvertimeShift(
  userId: string,
  windowStart: number,
  windowEnd: number,
): Promise<ShiftDocument | null> {
  const [dayStart, dayEnd] = dayKeyRange(toDayKey(windowStart));
  const snap = await adminDb
    .collection(SHIFTS)
    .where('userId', '==', userId)
    .where('startTime', '>=', Timestamp.fromMillis(dayStart - 12 * 3_600_000))
    .where('startTime', '<=', Timestamp.fromMillis(dayEnd))
    .get();

  let containing: ShiftDocument | null = null;

  for (const doc of snap.docs) {
    const shift = doc.data() as ShiftDocument;
    // `paysWage: false` is in-shift cover: overtime, but a zero-wage record of
    // somebody else's hours. Merging into it would hide an account inside a
    // shift that pays nothing.
    if (shift.isDeleted || shift.paysWage === false || !isOvertimeShift(shift)) continue;

    const start = shift.startTime.toMillis();
    const end = shift.endTime.toMillis();
    if (start === windowStart && end === windowEnd) return shift;
    // Kept, not returned: an exact match later in the snapshot is the better
    // answer and must win regardless of document order.
    if (containing === null && start <= windowStart && end >= windowEnd) containing = shift;
  }

  return containing;
}

function wallClock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimezone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

async function createCoverageShift(params: {
  userId: string;
  windowStart: number;
  windowEnd: number;
  creatorId: string;
  userTimezone: string;
  actorUid: string;
  offerId: string;
  paysWage: boolean;
}): Promise<string> {
  const ref = adminDb.collection(SHIFTS).doc();
  const shiftId = ref.id;
  const tz = params.userTimezone || 'UTC';

  const doc: Omit<ShiftDocument, 'createdAt' | 'updatedAt'> & { createdAt: unknown; updatedAt: unknown } = {
    shiftId,
    userId: params.userId,
    startTime: Timestamp.fromMillis(params.windowStart),
    endTime: Timestamp.fromMillis(params.windowEnd),
    wallClockStart: wallClock(params.windowStart, tz),
    wallClockEnd: wallClock(params.windowEnd, tz),
    userTimezone: tz,
    createdBy: params.actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    isRecurring: false,
    recurrence: null,
    seriesId: null,
    overrideDate: null,
    isDeleted: false,
    creatorIds: [params.creatorId],
    isOvertime: true,
    coverageOfferId: params.offerId,
    paysWage: params.paysWage,
  };

  await ref.set(doc);
  return shiftId;
}

/**
 * Withdraw an offer from the board.
 *
 * The shift created for an already-assigned offer is deleted with it — leaving
 * it behind would keep paying an agent for cover that was cancelled, and it is
 * the one write here that touches money.
 */
export async function cancelOffer(offerId: string): Promise<void> {
  const ref = adminDb.collection(OFFERS).doc(offerId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const offer = snap.data() as CaCoverageOfferDocument;
  const batch = adminDb.batch();

  if (offer.assignedShiftId) {
    const shiftRef = adminDb.collection(SHIFTS).doc(offer.assignedShiftId);
    const shiftSnap = await shiftRef.get();
    if (shiftSnap.exists) {
      const shift = shiftSnap.data() as ShiftDocument;
      const remaining = (shift.creatorIds ?? []).filter(id => id !== offer.creatorId);
      // The shift may cover several offers; only drop it once the last one goes.
      if (remaining.length === 0) batch.delete(shiftRef);
      else batch.update(shiftRef, { creatorIds: remaining, updatedAt: FieldValue.serverTimestamp() });
    }
  }

  batch.update(ref, {
    status: 'cancelled',
    assignedTo: null,
    assignedShiftId: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
}

/** Put an assigned offer back on the board, removing the shift it created. */
export async function unassignOffer(offerId: string): Promise<void> {
  const ref = adminDb.collection(OFFERS).doc(offerId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const offer = snap.data() as CaCoverageOfferDocument;
  if (offer.assignedShiftId) {
    const shiftRef = adminDb.collection(SHIFTS).doc(offer.assignedShiftId);
    const shiftSnap = await shiftRef.get();
    if (shiftSnap.exists) {
      const shift = shiftSnap.data() as ShiftDocument;
      const remaining = (shift.creatorIds ?? []).filter(id => id !== offer.creatorId);
      if (remaining.length === 0) await shiftRef.delete();
      else await shiftRef.update({ creatorIds: remaining, updatedAt: FieldValue.serverTimestamp() });
    }
  }

  await ref.update({
    status: 'available',
    assignedTo: null,
    assignedShiftId: null,
    assignedInShift: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
