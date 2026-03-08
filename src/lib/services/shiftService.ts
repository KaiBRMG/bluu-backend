import { adminDb } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { ShiftDocument, ShiftRecurrence, TimeEntryLedgerDocument, ActiveSessionDocument } from '@/types/firestore';

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
}

export interface UpdateShiftInput {
  userId?: string;
  startTime?: number;
  endTime?: number;
  wallClockStart?: string;
  wallClockEnd?: string;
  userTimezone?: string;
  recurrence?: ShiftRecurrence | null;
}

// ─── CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new shift document. Returns the new shiftId.
 */
export async function createShift(input: CreateShiftInput): Promise<string> {
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
    isRecurring: input.recurrence !== null,
    recurrence: input.recurrence,
    seriesId: null,
    overrideDate: null,
    isDeleted: false,
  };

  await ref.set(doc);
  return shiftId;
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
    patch.recurrence  = updates.recurrence ?? null;
    patch.isRecurring = updates.recurrence !== null;
  }

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
  // Set endDate to midnight of the day BEFORE newEndDateMs
  const dayBeforeMs = newEndDateMs - 24 * 60 * 60 * 1000;
  await adminDb.collection(SHIFTS).doc(seriesId).update({
    'recurrence.endDate': Timestamp.fromMillis(dayBeforeMs),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ─── Reads ───────────────────────────────────────────────────────────

/**
 * Fetch all shift documents whose startTime falls within [startMs, endMs],
 * PLUS all recurring root shifts that started before startMs (they may still
 * have occurrences within the window).
 */
export async function getShiftsByRange(
  startMs: number,
  endMs: number,
): Promise<ShiftDocument[]> {
  const startTs = Timestamp.fromMillis(startMs);
  const endTs   = Timestamp.fromMillis(endMs);

  const [rangeSnap, recurringSnap] = await Promise.all([
    // Shifts whose startTime is within the window (one-time + root recurring + overrides)
    adminDb.collection(SHIFTS)
      .where('startTime', '>=', startTs)
      .where('startTime', '<=', endTs)
      .get(),
    // Recurring roots that started BEFORE the window (may still generate occurrences in it)
    adminDb.collection(SHIFTS)
      .where('isRecurring', '==', true)
      .where('seriesId', '==', null)
      .where('startTime', '<', startTs)
      .get(),
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
    // Chunk into groups of 30 (Firestore 'in' limit)
    for (let i = 0; i < seriesIds.length; i += 30) {
      const chunk = seriesIds.slice(i, i + 30);
      const overridesSnap = await adminDb.collection(SHIFTS)
        .where('seriesId', 'in', chunk)
        .get();
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
 * Fetch all shift documents for a specific user within [startMs, endMs],
 * plus recurring roots for that user that started before the window.
 */
export async function getShiftsByUserAndRange(
  userId: string,
  startMs: number,
  endMs: number,
): Promise<ShiftDocument[]> {
  const startTs = Timestamp.fromMillis(startMs);
  const endTs   = Timestamp.fromMillis(endMs);

  const [rangeSnap, recurringSnap] = await Promise.all([
    adminDb.collection(SHIFTS)
      .where('userId', '==', userId)
      .where('startTime', '>=', startTs)
      .where('startTime', '<=', endTs)
      .get(),
    adminDb.collection(SHIFTS)
      .where('userId', '==', userId)
      .where('isRecurring', '==', true)
      .where('seriesId', '==', null)
      .where('startTime', '<', startTs)
      .get(),
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

  // Fetch overrides for any recurring series found
  const seriesIds = results
    .filter(s => s.isRecurring && !s.seriesId)
    .map(s => s.shiftId);

  if (seriesIds.length > 0) {
    for (let i = 0; i < seriesIds.length; i += 30) {
      const chunk = seriesIds.slice(i, i + 30);
      const overridesSnap = await adminDb.collection(SHIFTS)
        .where('seriesId', 'in', chunk)
        .get();
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
 * Batch-fetch time_entries for multiple users within a time window.
 * Returns all sessions that overlap [windowStartMs, windowEndMs], including
 * sessions that started before the window but ended inside it.
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

  const seen = new Set<string>();

  const addDoc = (doc: QueryDocumentSnapshot) => {
    if (seen.has(doc.id)) return;
    seen.add(doc.id);
    const data = doc.data() as TimeEntryLedgerDocument;
    const existing = result.get(data.userId) ?? [];
    existing.push(data);
    result.set(data.userId, existing);
  };

  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += 30) {
    chunks.push(userIds.slice(i, i + 30));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      // Query 1: sessions that started within the window (most common case)
      // Query 2: sessions that started before the window but ended inside it
      //          (e.g. clocked in the day before, shift starts partway through)
      const [startedInWindow, endedInWindow] = await Promise.all([
        adminDb.collection(TIME_ENTRIES)
          .where('userId', 'in', chunk)
          .where('startTime', '>=', startTs)
          .where('startTime', '<=', endTs)
          .orderBy('startTime', 'asc')
          .get(),
        adminDb.collection(TIME_ENTRIES)
          .where('userId', 'in', chunk)
          .where('endTime', '>=', startTs)
          .where('endTime', '<=', endTs)
          .orderBy('endTime', 'asc')
          .get(),
      ]);

      for (const doc of startedInWindow.docs) addDoc(doc);
      for (const doc of endedInWindow.docs) addDoc(doc);
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
