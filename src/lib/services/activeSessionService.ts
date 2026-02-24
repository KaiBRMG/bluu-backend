import { adminDb } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type {
  ActiveSessionDocument,
  ActiveSessionState,
  SessionEvent,
  ParsedSessionTotals,
  TimeEntryLedgerDocument,
} from '@/types/firestore';

const ACTIVE_SESSIONS = 'active_sessions';
const TIME_ENTRIES = 'time_entries';

// ─── active_sessions CRUD ────────────────────────────────────────────

export async function createActiveSession(
  userId: string,
  sessionId: string,
  startTime: number,
): Promise<void> {
  const ref = adminDb.collection(ACTIVE_SESSIONS).doc(userId);
  await ref.set({
    sessionId,
    userId,
    startTime: Timestamp.fromMillis(startTime),
    lastUpdated: FieldValue.serverTimestamp(),
    currentState: 'working' as ActiveSessionState,
    userClockOut: false,
  });
}

export async function getActiveSession(
  userId: string,
): Promise<{ data: ActiveSessionDocument } | null> {
  const doc = await adminDb.collection(ACTIVE_SESSIONS).doc(userId).get();
  if (!doc.exists) return null;
  return { data: doc.data() as ActiveSessionDocument };
}

/**
 * Update currentState on a session. Called on every state transition.
 * Also updates lastUpdated so the crash-detection Cloud Function doesn't
 * treat a deliberately idle/paused user as stale.
 */
export async function updateSessionState(
  userId: string,
  state: ActiveSessionState,
): Promise<void> {
  await adminDb.collection(ACTIVE_SESSIONS).doc(userId).update({
    currentState: state,
    lastUpdated: FieldValue.serverTimestamp(),
  });
}

/**
 * Heartbeat: update lastUpdated only. Called every 15 min when working.
 */
export async function heartbeatSession(userId: string): Promise<void> {
  await adminDb.collection(ACTIVE_SESSIONS).doc(userId).update({
    lastUpdated: FieldValue.serverTimestamp(),
  });
}

/**
 * Mark the session as gracefully closed (app window closed without explicit clock-out).
 * The session document is NOT deleted here — the local buffer is uploaded on next startup.
 */
export async function markUserClockOut(userId: string): Promise<void> {
  await adminDb.collection(ACTIVE_SESSIONS).doc(userId).update({
    userClockOut: true,
    lastUpdated: FieldValue.serverTimestamp(),
  });
}

// ─── Clock-out: commit to time_entries ───────────────────────────────

/**
 * Atomically write a time_entries ledger document and delete the active_sessions doc.
 * Called on explicit clock-out from the /stop route.
 */
export async function commitSession(
  userId: string,
  sessionId: string,
  startTimeMs: number,
  endTimeMs: number,
  parsedTotals: ParsedSessionTotals,
  eventLog: SessionEvent[],
  timezone: string,
  includeIdleTime: boolean,
): Promise<void> {
  const batch = adminDb.batch();

  const ledgerRef = adminDb.collection(TIME_ENTRIES).doc(sessionId);
  const ledgerDoc: Omit<TimeEntryLedgerDocument, 'createdAt'> & { createdAt: ReturnType<typeof FieldValue.serverTimestamp> } = {
    sessionId,
    userId,
    startTime: Timestamp.fromMillis(startTimeMs),
    endTime: Timestamp.fromMillis(endTimeMs),
    workingSeconds: parsedTotals.workingSeconds,
    idleSeconds: parsedTotals.idleSeconds,
    breakSeconds: parsedTotals.breakSeconds,
    pauseSeconds: parsedTotals.pauseSeconds,
    didNotClockOut: false,
    logUploadedAt: Timestamp.fromMillis(endTimeMs),
    eventLog,
    status: 'completed',
    isManual: false,
    modifications: [],
    originalData: { ...parsedTotals },
    includeIdleTime,
    timezone,
    createdAt: FieldValue.serverTimestamp(),
  };

  batch.set(ledgerRef, ledgerDoc);
  batch.delete(adminDb.collection(ACTIVE_SESSIONS).doc(userId));

  await batch.commit();
}

/**
 * Merge an event log into an existing time_entries doc created by the Cloud Function.
 * Called when the client uploads its local buffer after the CF already ran.
 */
export async function updateSessionLog(
  sessionId: string,
  eventLog: SessionEvent[],
  parsedTotals: ParsedSessionTotals,
): Promise<void> {
  await adminDb.collection(TIME_ENTRIES).doc(sessionId).update({
    eventLog,
    workingSeconds: parsedTotals.workingSeconds,
    idleSeconds: parsedTotals.idleSeconds,
    breakSeconds: parsedTotals.breakSeconds,
    pauseSeconds: parsedTotals.pauseSeconds,
    logUploadedAt: FieldValue.serverTimestamp(),
    status: 'completed',
  });
}

/**
 * Check whether a time_entries document already exists for a session.
 */
export async function ledgerDocExists(sessionId: string): Promise<boolean> {
  const doc = await adminDb.collection(TIME_ENTRIES).doc(sessionId).get();
  return doc.exists;
}

/**
 * Delete an active_sessions doc without creating a time_entries entry.
 * Used by /discard when the buffer is orphaned or the user explicitly discards.
 */
export async function deleteActiveSession(userId: string): Promise<void> {
  await adminDb.collection(ACTIVE_SESSIONS).doc(userId).delete();
}

// ─── Ledger reads (for entries route) ───────────────────────────────

export async function getLedgerEntriesByDateRange(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<Array<{ id: string; data: TimeEntryLedgerDocument }>> {
  const startTs = Timestamp.fromDate(startDate);
  const endTs = Timestamp.fromDate(endDate);

  const snap = await adminDb
    .collection(TIME_ENTRIES)
    .where('userId', '==', userId)
    .where('startTime', '>=', startTs)
    .where('startTime', '<=', endTs)
    .orderBy('startTime', 'asc')
    .get();

  return snap.docs.map(doc => ({ id: doc.id, data: doc.data() as TimeEntryLedgerDocument }));
}
