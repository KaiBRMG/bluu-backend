import { adminDb } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { ShiftDocument, ShiftRecurrence, TimeEntryLedgerDocument, ActiveSessionDocument } from '@/types/firestore';
import type { SplitLeave } from '../shifts/seriesSplitPlan';

const SHIFTS = 'shifts';
const TIME_ENTRIES = 'time_entries';
const ACTIVE_SESSIONS = 'active_sessions';

// ─── Input types ─────────────────────────────────────────────────────

export interface CreateShiftInput {
  userId: string;
  startTime: number;          // ms UTC
  endTime: number;            // ms UTC
  wallClockStart: string;     // "HH:mm"
  wallClockEnd: string;       // "HH:mm"
  userTimezone: string;       // IANA
  createdBy: string;          // admin uid
  recurrence: ShiftRecurrence | null;
  /**
   * Creator accounts the agent covers. Validated by `normaliseCreatorIds`
   * before it gets here — the count sets the hourly wage tier, so an id that
   * does not resolve would pay for an account nobody works.
   */
  creatorIds?: string[];
  /**
   * The subset of `creatorIds` worked as unpaid overtime *inside* this shift.
   * Intersected with `creatorIds` by the API before it gets here — storing an id
   * that is not assigned would subtract an account the agent never worked.
   */
  overtimeCreatorIds?: string[];
  isOvertime?: boolean;
  coverageOfferId?: string | null;
  paysWage?: boolean;
}

export interface UpdateShiftInput {
  userId?: string;
  startTime?: number;
  endTime?: number;
  wallClockStart?: string;
  wallClockEnd?: string;
  userTimezone?: string;
  recurrence?: ShiftRecurrence | null;
  creatorIds?: string[];
  overtimeCreatorIds?: string[];
}

/**
 * Coerce `recurrence.endDate` to a Timestamp before it is stored.
 *
 * The shift modal sends an ISO **string**, and this used to be written straight
 * through while `truncateSeriesAt` wrote a real `Timestamp` — two writers, two
 * shapes, and a reader (`serialiseRecurrence`) that only handled one. The result
 * was `r.endDate.toDate is not a function`, which 500'd the entire week view.
 *
 * Normalising on the way in is the half that stops new bad documents;
 * `toIsoString` on the way out is the half that tolerates the ones already
 * written. Both are needed, and neither is redundant.
 */
function toRecurrenceTimestamp(value: unknown): Timestamp | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return Timestamp.fromDate((value as { toDate: () => Date }).toDate());
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : Timestamp.fromDate(value);
  if (typeof value === 'number') return Number.isFinite(value) ? Timestamp.fromMillis(value) : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : Timestamp.fromMillis(ms);
  }
  return null;
}

/** Normalise a whole recurrence rule for storage. */
function normaliseRecurrence(r: ShiftRecurrence | null | undefined): ShiftRecurrence | null {
  if (!r) return null;
  return { ...r, endDate: toRecurrenceTimestamp(r.endDate) };
}

// ─── CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new shift document. Returns the new shiftId.
 */
export async function createShift(input: CreateShiftInput): Promise<string> {
  const ref = adminDb.collection(SHIFTS).doc();
  await ref.set(newRootShiftDoc(ref.id, input));
  return ref.id;
}

/**
 * The document `createShift` writes, for a caller that must put it in a batch
 * with other writes (splitting a series is truncate + create + re-point, and a
 * half-applied split shows an occurrence twice or not at all).
 */
export function newRootShiftDoc(shiftId: string, input: CreateShiftInput) {
  const doc: Omit<ShiftDocument, 'createdAt' | 'updatedAt'> & {
    createdAt: ReturnType<typeof FieldValue.serverTimestamp>;
    updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
  } = {
    shiftId,
    userId: input.userId,
    startTime: Timestamp.fromMillis(input.startTime),
    endTime: Timestamp.fromMillis(input.endTime),
    wallClockStart: input.wallClockStart,
    wallClockEnd: input.wallClockEnd,
    userTimezone: input.userTimezone,
    createdBy: input.createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    isRecurring: input.recurrence !== null,
    recurrence: normaliseRecurrence(input.recurrence),
    seriesId: null,
    overrideDate: null,
    isDeleted: false,
    creatorIds: input.creatorIds ?? [],
    overtimeCreatorIds: input.overtimeCreatorIds ?? [],
    isOvertime: input.isOvertime ?? false,
    coverageOfferId: input.coverageOfferId ?? null,
    paysWage: input.paysWage ?? true,
  };
  return doc;
}

/**
 * Update fields on an existing shift document.
 */
export async function updateShift(
  shiftId: string,
  updates: UpdateShiftInput,
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if (updates.userId !== undefined)       patch.userId       = updates.userId;
  if (updates.wallClockStart !== undefined) patch.wallClockStart = updates.wallClockStart;
  if (updates.wallClockEnd !== undefined)   patch.wallClockEnd   = updates.wallClockEnd;
  if (updates.userTimezone !== undefined)   patch.userTimezone   = updates.userTimezone;
  if (updates.startTime !== undefined)    patch.startTime    = Timestamp.fromMillis(updates.startTime);
  if (updates.endTime !== undefined)      patch.endTime      = Timestamp.fromMillis(updates.endTime);
  if ('recurrence' in updates) {
    patch.recurrence  = normaliseRecurrence(updates.recurrence);
    patch.isRecurring = updates.recurrence != null;
  }
  // `in` rather than `!== undefined` so an explicit empty array clears the
  // assignment instead of being read as "leave it alone".
  if ('creatorIds' in updates) patch.creatorIds = updates.creatorIds ?? [];
  // Written whenever the assignment is, never independently: the two are one
  // fact (which accounts, and which of them pay) and letting them drift would
  // leave an overtime id pointing at an account no longer on the shift.
  if ('overtimeCreatorIds' in updates) patch.overtimeCreatorIds = updates.overtimeCreatorIds ?? [];

  await adminDb.collection(SHIFTS).doc(shiftId).update(patch);
}

/**
 * Delete a single shift document.
 */
export async function deleteShift(shiftId: string): Promise<void> {
  await adminDb.collection(SHIFTS).doc(shiftId).delete();
}

/**
 * Delete all shift documents belonging to a series (the root + all overrides/tombstones).
 * Uses batched writes (max 500 ops per batch).
 */
export async function deleteShiftSeries(seriesId: string): Promise<void> {
  // Query: root doc (shiftId == seriesId) + all override/tombstone docs (seriesId == seriesId)
  const [rootSnap, overridesSnap] = await Promise.all([
    adminDb.collection(SHIFTS).doc(seriesId).get(),
    adminDb.collection(SHIFTS).where('seriesId', '==', seriesId).get(),
  ]);

  const refs = [];
  if (rootSnap.exists) refs.push(rootSnap.ref);
  for (const doc of overridesSnap.docs) refs.push(doc.ref);

  // Batch delete in chunks of 500
  for (let i = 0; i < refs.length; i += 500) {
    const batch = adminDb.batch();
    refs.slice(i, i + 500).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

/**
 * Create a per-instance override document for a single occurrence of a recurring series.
 * The original root shift is left untouched.
 */
export async function createOccurrenceOverride(
  seriesId: string,
  overrideDateMs: number,   // UTC midnight of the occurrence date being overridden
  input: CreateShiftInput,
  isDeleted = false,
): Promise<string> {
  const ref = adminDb.collection(SHIFTS).doc();
  const shiftId = ref.id;

  const doc: Omit<ShiftDocument, 'createdAt' | 'updatedAt'> & {
    createdAt: ReturnType<typeof FieldValue.serverTimestamp>;
    updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
  } = {
    shiftId,
    userId: input.userId,
    startTime: Timestamp.fromMillis(input.startTime),
    endTime: Timestamp.fromMillis(input.endTime),
    wallClockStart: input.wallClockStart,
    wallClockEnd: input.wallClockEnd,
    userTimezone: input.userTimezone,
    createdBy: input.createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    isRecurring: false,
    recurrence: null,
    seriesId,
    overrideDate: Timestamp.fromMillis(overrideDateMs),
    isDeleted,
    creatorIds: input.creatorIds ?? [],
    overtimeCreatorIds: input.overtimeCreatorIds ?? [],
    isOvertime: input.isOvertime ?? false,
    coverageOfferId: input.coverageOfferId ?? null,
    paysWage: input.paysWage ?? true,
  };

  await ref.set(doc);
  return shiftId;
}

/**
 * Mark a single occurrence of a recurring series as deleted (tombstone).
 * Creates an override doc with isDeleted: true so the expansion utility skips that date.
 */
export async function deleteOccurrence(
  seriesId: string,
  overrideDateMs: number,
  userId: string,
  createdBy: string,
  userTimezone: string,
): Promise<void> {
  await createOccurrenceOverride(
    seriesId,
    overrideDateMs,
    {
      userId,
      startTime: overrideDateMs,
      endTime: overrideDateMs,
      wallClockStart: '00:00',
      wallClockEnd: '00:00',
      userTimezone,
      createdBy,
      recurrence: null,
    },
    true, // isDeleted
  );
}

/**
 * Truncate a recurring series at a given occurrence date by setting the root shift's
 * recurrence.endDate to the day before the given occurrence.
 */
export async function truncateSeriesAt(
  seriesId: string,
  newEndDateMs: number,   // UTC ms of the last occurrence to KEEP (exclusive — day before this becomes endDate)
): Promise<void> {
  await adminDb.collection(SHIFTS).doc(seriesId).update(truncateSeriesPatch(newEndDateMs));
}

/** The update `truncateSeriesAt` applies, for a caller writing it inside a batch. */
export function truncateSeriesPatch(newEndDateMs: number): Record<string, unknown> {
  // Set endDate to midnight of the day BEFORE newEndDateMs
  const dayBeforeMs = newEndDateMs - 24 * 60 * 60 * 1000;
  return {
    'recurrence.endDate': Timestamp.fromMillis(dayBeforeMs),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

// ─── Splitting a series ──────────────────────────────────────────────

const LEAVE_REQUESTS = 'leave_requests';

/** One split, ready to write. Built by `seriesSplitPlan.ts` helpers — see there for why each part exists. */
export interface SeriesSplitWrite {
  rootId: string;
  /** UTC midnight of the first date the new root owns. */
  truncateAtMs: number;
  newRoot: CreateShiftInput;
  /** Overrides / tombstones moving to the new root, with any field changes folded in. */
  repoint: Array<{ shiftId: string; patch?: Record<string, unknown> | null }>;
  /** Approved leave whose released occurrence now belongs to the new root. */
  leaves: Array<{ leaveId: string; releasedOccurrenceStart: number }>;
}

/**
 * Write a split atomically: truncate, create, re-point, move leave. One batch,
 * because half a split is worse than none — a new root without its re-points
 * shows edited days twice and released days again.
 *
 * Refuses rather than writing in pieces when the split is larger than a batch
 * (500 writes); no real series has hundreds of future exceptions.
 */
export async function commitSeriesSplit(split: SeriesSplitWrite): Promise<string> {
  const ops = 2 + split.repoint.length + split.leaves.length;
  if (ops > 500) throw new Error(`Series ${split.rootId} has too many future exceptions to split in one write (${ops}).`);

  const batch = adminDb.batch();
  const newRef = adminDb.collection(SHIFTS).doc();
  batch.update(adminDb.collection(SHIFTS).doc(split.rootId), truncateSeriesPatch(split.truncateAtMs));
  batch.set(newRef, newRootShiftDoc(newRef.id, split.newRoot));
  for (const o of split.repoint) {
    batch.update(adminDb.collection(SHIFTS).doc(o.shiftId), {
      seriesId: newRef.id,
      ...(o.patch ?? {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const l of split.leaves) {
    batch.update(adminDb.collection(LEAVE_REQUESTS).doc(l.leaveId), {
      releasedShiftId: newRef.id,
      releasedOccurrenceStart: l.releasedOccurrenceStart,
    });
  }
  await batch.commit();
  return newRef.id;
}

/**
 * Leave requests whose occurrence is at or after `fromMs`, less a week of
 * slack for one the release resolved away from its pin. Queried on
 * `occurrenceStart` (indexed); `releasedShiftId` is matched in memory.
 */
export async function getLeaveForSplit(fromMs: number): Promise<SplitLeave[]> {
  const snap = await adminDb
    .collection(LEAVE_REQUESTS)
    .where('occurrenceStart', '>=', fromMs - 7 * 24 * 60 * 60 * 1000)
    .get();
  return snap.docs.map(d => ({
    leaveId: d.id,
    userId: d.get('userId'),
    status: d.get('status'),
    shiftId: d.get('shiftId'),
    occurrenceStart: d.get('occurrenceStart'),
    releasedShiftId: d.get('releasedShiftId') ?? null,
    releasedOccurrenceStart: d.get('releasedOccurrenceStart') ?? null,
  }));
}

// ─── Reads ───────────────────────────────────────────────────────────

/**
 * Fetch shift documents within [startMs, endMs], optionally filtered to a
 * single user. Also fetches recurring root shifts that started before the
 * window (they may still generate occurrences within it) and any
 * override/tombstone documents for those recurring series.
 *
 * When userId is null, returns shifts for ALL users.
 */
export async function getShiftsByRange(
  startMs: number,
  endMs: number,
  userId: string | null = null,
): Promise<ShiftDocument[]> {
  const startTs = Timestamp.fromMillis(startMs);
  const endTs   = Timestamp.fromMillis(endMs);

  // Build queries — optionally scoped to a single user
  let rangeQuery = adminDb.collection(SHIFTS)
    .where('startTime', '>=', startTs)
    .where('startTime', '<=', endTs);
  let recurringQuery = adminDb.collection(SHIFTS)
    .where('isRecurring', '==', true)
    .where('seriesId', '==', null)
    .where('startTime', '<', startTs);

  if (userId) {
    rangeQuery = rangeQuery.where('userId', '==', userId);
    recurringQuery = recurringQuery.where('userId', '==', userId);
  }

  const [rangeSnap, recurringSnap] = await Promise.all([
    rangeQuery.get(),
    recurringQuery.get(),
  ]);

  const seen = new Set<string>();
  const results: ShiftDocument[] = [];

  for (const snap of [rangeSnap, recurringSnap]) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      results.push(doc.data() as ShiftDocument);
    }
  }

  // Also fetch override/tombstone docs for any recurring series in results
  const seriesIds = results
    .filter(s => s.isRecurring && !s.seriesId)
    .map(s => s.shiftId);

  if (seriesIds.length > 0) {
    // Chunk into groups of 30 (Firestore 'in' limit) and query in parallel
    const chunks: string[][] = [];
    for (let i = 0; i < seriesIds.length; i += 30) {
      chunks.push(seriesIds.slice(i, i + 30));
    }
    const overrideSnaps = await Promise.all(
      chunks.map(chunk =>
        adminDb.collection(SHIFTS).where('seriesId', 'in', chunk).get()
      )
    );
    for (const overridesSnap of overrideSnaps) {
      for (const doc of overridesSnap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        results.push(doc.data() as ShiftDocument);
      }
    }
  }

  return results;
}

/**
 * Fetch all shift documents for a specific user within [startMs, endMs].
 * Convenience wrapper around getShiftsByRange.
 */
export async function getShiftsByUserAndRange(
  userId: string,
  startMs: number,
  endMs: number,
): Promise<ShiftDocument[]> {
  return getShiftsByRange(startMs, endMs, userId);
}

/**
 * Batch-fetch time_entries for multiple users within a time window.
 * Chunks userIds into groups of 30 to stay within Firestore's 'in' query limit.
 * Returns a Map keyed by userId.
 */
export async function getLedgerEntriesForUsers(
  userIds: string[],
  windowStartMs: number,
  windowEndMs: number,
): Promise<Map<string, TimeEntryLedgerDocument[]>> {
  const result = new Map<string, TimeEntryLedgerDocument[]>();
  if (userIds.length === 0) return result;

  const startTs = Timestamp.fromMillis(windowStartMs);
  const endTs   = Timestamp.fromMillis(windowEndMs);

  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += 30) {
    chunks.push(userIds.slice(i, i + 30));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const snap = await adminDb.collection(TIME_ENTRIES)
        .where('userId', 'in', chunk)
        .where('startTime', '>=', startTs)
        .where('startTime', '<=', endTs)
        .orderBy('startTime', 'asc')
        .get();

      for (const doc of snap.docs) {
        const data = doc.data() as TimeEntryLedgerDocument;
        const existing = result.get(data.userId) ?? [];
        existing.push(data);
        result.set(data.userId, existing);
      }
    }),
  );

  return result;
}

/**
 * Batch-fetch active_sessions documents for multiple users in a single getAll call.
 * Returns a Map keyed by userId.
 */
export async function getActiveSessionsForUsers(
  userIds: string[],
): Promise<Map<string, ActiveSessionDocument>> {
  const result = new Map<string, ActiveSessionDocument>();
  if (userIds.length === 0) return result;

  const refs = userIds.map(uid => adminDb.collection(ACTIVE_SESSIONS).doc(uid));
  const docs = await adminDb.getAll(...refs);

  for (const doc of docs) {
    if (doc.exists) {
      const data = doc.data() as ActiveSessionDocument;
      result.set(data.userId, data);
    }
  }

  return result;
}
