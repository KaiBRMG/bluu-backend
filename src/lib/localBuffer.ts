'use client';

import type { LocalSessionBuffer, SessionEvent } from '@/types/firestore';
export { parseBuffer } from '@/lib/parseBuffer';

// ─── IndexedDB helpers ───────────────────────────────────────────────

const DB_NAME = 'bluu_time_tracking';
const DB_VERSION = 1;
const STORE_NAME = 'session_buffers';
const LAST_SESSION_KEY = '__last_session_id__';
const SESSION_INDEX_KEY = '__session_index__';

/**
 * Each entry in the session index tracks a session's lifecycle for
 * the retention policy: only delete a buffer once it's flushed to Firestore
 * AND it's the day after the session ended (in the user's timezone).
 */
export interface SessionIndexEntry {
  sessionId: string;
  startTime: number;  // ms — used to determine which calendar day the session belongs to
  endTime?: number;   // ms — set when clock-out event is appended
  flushed: boolean;   // true once uploaded to Firestore
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbSet(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function bufferKey(sessionId: string): string {
  return `session_${sessionId}`;
}

// ─── Session index helpers ────────────────────────────────────────────

async function getSessionIndex(db: IDBDatabase): Promise<SessionIndexEntry[]> {
  return (await idbGet<SessionIndexEntry[]>(db, SESSION_INDEX_KEY)) ?? [];
}

async function saveSessionIndex(db: IDBDatabase, index: SessionIndexEntry[]): Promise<void> {
  await idbSet(db, SESSION_INDEX_KEY, index);
}

/**
 * Returns YYYY-MM-DD for a given ms timestamp in the provided IANA timezone.
 */
function dateStringInTZ(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Returns YYYY-MM-DD for today in the provided IANA timezone.
 */
function todayStringInTZ(timezone: string): string {
  return dateStringInTZ(Date.now(), timezone);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Create a new buffer in IndexedDB, record the session ID as the last known
 * session, and register it in the day session index.
 * Writes an initial 'clock-in' event.
 */
export async function initBuffer(sessionId: string, userId: string, startTime: number): Promise<void> {
  const db = await openDB();
  const buffer: LocalSessionBuffer = {
    sessionId,
    userId,
    startTime,
    events: [{ type: 'clock-in', timestamp: startTime }],
  };
  const index = await getSessionIndex(db);
  // Remove any stale entry for this sessionId (crash recovery re-init)
  const filtered = index.filter(e => e.sessionId !== sessionId);
  filtered.push({ sessionId, startTime, flushed: false });
  await Promise.all([
    idbSet(db, bufferKey(sessionId), buffer),
    idbSet(db, LAST_SESSION_KEY, sessionId),
    saveSessionIndex(db, filtered),
  ]);
}

/**
 * Append a single event to the buffer for the given session.
 * Safe to call even if the buffer doesn't exist (no-op).
 * If the event is 'clock-out', records the endTime in the session index.
 */
export async function appendEvent(sessionId: string, event: SessionEvent): Promise<void> {
  const db = await openDB();
  const key = bufferKey(sessionId);
  const buffer = await idbGet<LocalSessionBuffer>(db, key);
  if (!buffer) return;
  buffer.events.push(event);

  if (event.type === 'clock-out') {
    // Update index with end time
    const index = await getSessionIndex(db);
    const entry = index.find(e => e.sessionId === sessionId);
    if (entry) {
      entry.endTime = event.timestamp;
      await Promise.all([
        idbSet(db, key, buffer),
        saveSessionIndex(db, index),
      ]);
      return;
    }
  }

  await idbSet(db, key, buffer);
}

/**
 * Retrieve the buffer for a specific session, or null if it doesn't exist.
 */
export async function getBuffer(sessionId: string): Promise<LocalSessionBuffer | null> {
  const db = await openDB();
  return (await idbGet<LocalSessionBuffer>(db, bufferKey(sessionId))) ?? null;
}

/**
 * Get the sessionId of the last known session (survives app restarts).
 */
export async function getLastSessionId(): Promise<string | null> {
  const db = await openDB();
  return (await idbGet<string>(db, LAST_SESSION_KEY)) ?? null;
}

/**
 * Mark the buffer as flushed (update lastFlushed timestamp + index flushed flag).
 */
export async function markBufferFlushed(sessionId: string): Promise<void> {
  const db = await openDB();
  const key = bufferKey(sessionId);
  const buffer = await idbGet<LocalSessionBuffer>(db, key);
  if (!buffer) return;
  buffer.lastFlushed = Date.now();

  const index = await getSessionIndex(db);
  const entry = index.find(e => e.sessionId === sessionId);
  if (entry) entry.flushed = true;

  await Promise.all([
    idbSet(db, key, buffer),
    saveSessionIndex(db, index),
  ]);
}

/**
 * Mark a session as flushed (uploaded to Firestore) after successful clock-out.
 * Clears the last-session pointer so future startups don't try to resume it.
 * Does NOT delete the IDB buffer record — getTodaySessions() still needs it
 * for the rest of the day. pruneOldSessions() handles deletion the next day.
 */
export async function clearBuffer(sessionId: string): Promise<void> {
  const db = await openDB();

  // Clear the "last session" pointer so we don't attempt to resume this session
  const lastId = await idbGet<string>(db, LAST_SESSION_KEY);
  if (lastId === sessionId) {
    await idbDelete(db, LAST_SESSION_KEY);
  }

  // Mark flushed in index + record endTime so retention policy can clean it up tomorrow
  const index = await getSessionIndex(db);
  const entry = index.find(e => e.sessionId === sessionId);
  if (entry) {
    entry.flushed = true;
    if (!entry.endTime) entry.endTime = Date.now();
    await saveSessionIndex(db, index);
  }

  // Also stamp lastFlushed on the buffer itself (keeps it consistent with markBufferFlushed)
  const key = bufferKey(sessionId);
  const buffer = await idbGet<LocalSessionBuffer>(db, key);
  if (buffer) {
    buffer.lastFlushed = Date.now();
    await idbSet(db, key, buffer);
  }
}

/**
 * Returns all session buffers whose clock-in time falls within today's
 * 00:00–23:59 in the user's timezone.
 *
 * Includes the active (open) session as well as completed sessions from
 * earlier in the day. Completed sessions that haven't been pruned yet
 * are preserved in the index until the next day.
 */
export async function getTodaySessions(timezone: string): Promise<LocalSessionBuffer[]> {
  const db = await openDB();
  const index = await getSessionIndex(db);
  const todayStr = todayStringInTZ(timezone);

  const results: LocalSessionBuffer[] = [];
  for (const entry of index) {
    const entryDateStr = dateStringInTZ(entry.startTime, timezone);
    if (entryDateStr === todayStr) {
      const buf = await idbGet<LocalSessionBuffer>(db, bufferKey(entry.sessionId));
      if (buf) results.push(buf);
    }
  }
  return results;
}

/**
 * Prune session index entries (and their buffers, if any) where:
 *   - The session is marked as flushed, AND
 *   - The session ended on a day before today (in user's timezone)
 *
 * Call this once at app startup.
 */
export async function pruneOldSessions(timezone: string): Promise<void> {
  const db = await openDB();
  const index = await getSessionIndex(db);
  const todayStr = todayStringInTZ(timezone);

  const toKeep: SessionIndexEntry[] = [];
  const toDelete: string[] = [];

  for (const entry of index) {
    // Determine the day of the session: use endTime if known, else startTime
    const sessionDayMs = entry.endTime ?? entry.startTime;
    const sessionDayStr = dateStringInTZ(sessionDayMs, timezone);
    const isPastDay = sessionDayStr < todayStr;

    if (entry.flushed && isPastDay) {
      toDelete.push(entry.sessionId);
    } else {
      toKeep.push(entry);
    }
  }

  if (toDelete.length === 0) return;

  await saveSessionIndex(db, toKeep);
  await Promise.all(toDelete.map(sid => idbDelete(db, bufferKey(sid))));
}
