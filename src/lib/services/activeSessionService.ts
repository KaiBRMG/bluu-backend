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
  enableIdleTimeout: boolean,
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
    enableIdleTimeout,
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
 * Also corrects endTime to the actual last-activity timestamp from the buffer.
 */
export async function updateSessionLog(
  sessionId: string,
  eventLog: SessionEvent[],
  parsedTotals: ParsedSessionTotals,
  endTimeMs: number,
): Promise<void> {
  await adminDb.collection(TIME_ENTRIES).doc(sessionId).update({
    eventLog,
    endTime: Timestamp.fromMillis(endTimeMs),
    workingSeconds: parsedTotals.workingSeconds,
    idleSeconds: parsedTotals.idleSeconds,
    breakSeconds: parsedTotals.breakSeconds,
    pauseSeconds: parsedTotals.pauseSeconds,
    logUploadedAt: FieldValue.serverTimestamp(),
    status: 'completed',
  });
}

/**
 * Owner + status of a session's ledger doc, or null if no doc exists.
 *
 * Returns these rather than a bare "does it exist" so callers can authorize
 * before writing: the session id comes from the client and `updateSessionLog`
 * takes one directly, so both who owns the doc and whether it is still awaiting
 * a log have to be checked first (cross-cutting rule 10).
 */
export async function getLedgerSessionMeta(
  sessionId: string,
): Promise<{ userId: string | null; status: TimeEntryLedgerDocument['status'] } | null> {
  const doc = await adminDb.collection(TIME_ENTRIES).doc(sessionId).get();
  if (!doc.exists) return null;
  const data = doc.data() as TimeEntryLedgerDocument;
  return { userId: data.userId ?? null, status: data.status };
}

/**
 * Update the most recent activity % recorded for a user's active session.
 * Called fire-and-forget from the screenshot upload route.
 */
export async function updateActivityPercent(userId: string, percent: number): Promise<void> {
  await adminDb.collection(ACTIVE_SESSIONS).doc(userId).update({
    lastActivityPercent: percent,
  });
}

/**
 * The placeholder ledger doc for a session whose event log is not available
 * server-side — it lives only in the IndexedDB of the device that recorded it.
 *
 * Writing this reserves the session in the ledger so that device's later
 * `/upload-log` lands on the merge branch and fills in the real event log and
 * totals. Without it that upload finds nothing to attach to and answers
 * `discarded`, silently destroying a real shift.
 *
 * Aggregates start at 0 rather than being inferred from the session's span: an
 * empty event log means *unknown*, never "worked the whole time"
 * (time-tracking.md, analytics trap 1). Nothing here comes from the client.
 *
 * Mirrors what `cleanupStaleSessions` writes in `functions/index.js` — change
 * both together.
 */
export function buildInterruptedLedgerDoc(
  session: ActiveSessionDocument,
  timezone: string,
  enableIdleTimeout: boolean,
): Omit<TimeEntryLedgerDocument, 'createdAt'> & { createdAt: ReturnType<typeof FieldValue.serverTimestamp> } {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    startTime: session.startTime,
    endTime: session.lastUpdated ?? Timestamp.now(),
    workingSeconds: 0,
    idleSeconds: 0,
    breakSeconds: 0,
    pauseSeconds: 0,
    didNotClockOut: true,
    logUploadedAt: null,  // the owning device fills this in via /upload-log
    eventLog: [],
    status: 'interrupted',
    isManual: false,
    modifications: [],
    originalData: { workingSeconds: 0, idleSeconds: 0, breakSeconds: 0, pauseSeconds: 0 },
    enableIdleTimeout,
    timezone,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Close an active session this device cannot account for, WITHOUT destroying it.
 *
 * The case: a user tracks time on device A, closes the app without pressing
 * Clock Out (a soft clock-out leaves `active_sessions` behind, with the only
 * event log sitting in device A's IndexedDB), then clocks in on device B.
 * Device B holds no buffer for that session, so it cannot commit it — but
 * deleting the doc outright stranded the session: device A's later `/upload-log`
 * found neither an active session nor a ledger doc and answered `discarded`,
 * throwing a full shift of real worked time away.
 *
 * Instead write `buildInterruptedLedgerDoc`'s placeholder, so the session exists
 * in the ledger immediately and device A's upload merges its event log in,
 * recovering the real hours.
 *
 * Returns the closed session's id, or null if there was nothing to close.
 */
export async function interruptActiveSession(
  userId: string,
  timezone: string,
  enableIdleTimeout: boolean,
): Promise<{ sessionId: string; startTimeMs: number } | null> {
  const activeRef = adminDb.collection(ACTIVE_SESSIONS).doc(userId);
  const activeSnap = await activeRef.get();
  if (!activeSnap.exists) return null;

  const data = activeSnap.data() as ActiveSessionDocument;
  const sessionId = data.sessionId;

  // Malformed doc — nothing to preserve, just clear it so the user can start.
  if (!sessionId) {
    await activeRef.delete();
    return null;
  }

  const ledgerRef = adminDb.collection(TIME_ENTRIES).doc(sessionId);
  const batch = adminDb.batch();

  // A ledger doc already here means the session was committed (or the CF already
  // closed it) and this active doc is a leftover. Overwriting would wipe a real
  // event log, so only drop the stale active doc.
  const ledgerSnap = await ledgerRef.get();
  if (!ledgerSnap.exists) {
    batch.set(ledgerRef, buildInterruptedLedgerDoc(data, timezone, enableIdleTimeout));
  }

  batch.delete(activeRef);
  await batch.commit();

  return { sessionId, startTimeMs: data.startTime.toMillis() };
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
