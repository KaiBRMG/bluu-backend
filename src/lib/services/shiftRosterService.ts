import { adminDb } from '@/lib/firebase-admin';
import { getAllTimeTrackingUsers } from '@/lib/services/userService';
import {
  getShiftsByRange,
  getShiftsByUserAndRange,
  getLedgerEntriesForUsers,
  getActiveSessionsForUsers,
} from '@/lib/services/shiftService';
import { expandShiftsForWindow, type ExpandedShift } from '@/lib/utils/recurrence';
import { serialiseShift } from '@/lib/utils/shiftSerialise';
import { matchLeaveToOccurrences, occurrenceKey } from '@/lib/utils/leaveMatch';
import { computeAttendance, computeTimeWorked } from '@/lib/utils/shiftAttendance';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

/**
 * The shift roster for a time window — every occurrence, expanded, with the
 * eligible people behind them.
 *
 * Shared by `GET /api/shifts/week` (Shift Management → Schedule, people as
 * rows) and `GET /api/ca-shift-calendar` (CA Portal → Shift Calendar, creators
 * as rows), so the two grids can never disagree about which shifts exist.
 *
 * **Eligibility** is the Schedule's rule, unchanged: unarchived users who hold
 * `time-tracking`. Shifts belonging to anyone else are dropped.
 *
 * `includeDetail` adds the admin-only facts — attendance, time worked and leave
 * requests — which cost the ledger, active-session and leave reads. Leave it off
 * for a reader who will never see them; the projection then costs only the
 * shift query and the user reads.
 */

export interface RosterUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
  timezone: string;
  enableIdleTimeout: boolean;
  groups: string[];
}

interface UserDoc {
  uid?: string;
  isArchived?: boolean;
  permittedPageIds?: string[];
  displayName?: string;
  photoURL?: string | null;
  timezone?: string;
  enableIdleTimeout?: boolean;
  groups?: string[];
}

export interface RosterOptions {
  windowStartMs: number;
  windowEndMs: number;
  /** Restrict to one user's shifts. */
  filterUserId?: string | null;
  /** Attendance, time worked and leave (admin-only facts). */
  includeDetail: boolean;
  /**
   * Return every eligible user, not only those holding a shift in the window.
   * The shift-assignment picker needs the full list; a read-only reader does not.
   */
  includeAllUsers: boolean;
}

export async function loadShiftRoster(opts: RosterOptions): Promise<{ shifts: ExpandedShift[]; users: RosterUser[] }> {
  const { windowStartMs, windowEndMs, filterUserId = null, includeDetail, includeAllUsers } = opts;

  // ── 1. Shifts in the window (1–2 Firestore queries) ─────────────────
  const rawShifts = filterUserId
    ? await getShiftsByUserAndRange(filterUserId, windowStartMs, windowEndMs)
    : await getShiftsByRange(windowStartMs, windowEndMs);

  // ── 2. The people behind them ───────────────────────────────────────
  // Every time-tracking user (one query) when the full list is wanted, plus any
  // user a shift references who is not in that set — read in one getAll.
  const shiftUserIds = [...new Set(rawShifts.map(s => s.userId))];
  const shiftUserRefs = shiftUserIds.map(uid => adminDb.collection('users').doc(uid));

  const [allTtUsers, shiftUserSnaps] = await Promise.all([
    includeAllUsers ? (getAllTimeTrackingUsers() as Promise<UserDoc[]>) : Promise.resolve([] as UserDoc[]),
    shiftUserIds.length > 0
      ? adminDb.getAll(...shiftUserRefs)
      : Promise.resolve([] as DocumentSnapshot[]),
  ]);

  // Archived users are excluded — they are removed from the system, so they
  // must not appear in the shift grid or the shift-assignment picker.
  const userMap = new Map<string, UserDoc>();
  for (const u of allTtUsers) {
    if (u?.uid && u.isArchived !== true) userMap.set(u.uid, u);
  }
  shiftUserSnaps.forEach((snap, i) => {
    const uid = shiftUserIds[i];
    const user = snap.exists ? (snap.data() as UserDoc) : null;
    if (!userMap.has(uid) && user?.isArchived !== true && user?.permittedPageIds?.includes('time-tracking')) {
      userMap.set(uid, user);
    }
  });

  const eligibleUserIds = new Set(userMap.keys());

  // ── 3. Expand recurrence server-side ────────────────────────────────
  const eligibleRaw = rawShifts
    .filter(s => eligibleUserIds.has(s.userId))
    .map(s => ({
      ...serialiseShift(s),
      timeWorkedSeconds: null as number | null,
      attendanceStatus: null as 'on-time' | 'late' | 'absent' | null,
    }));

  // Per-occurrence, so attendance and time worked are computed against each
  // occurrence's own start/end rather than the root document's timestamp.
  const expandedShifts = expandShiftsForWindow(eligibleRaw, windowStartMs, windowEndMs);

  const users: RosterUser[] = [...eligibleUserIds].map(uid => {
    const u = userMap.get(uid);
    return {
      uid,
      displayName:       u?.displayName    ?? uid,
      photoURL:          u?.photoURL       ?? null,
      timezone:          u?.timezone       || 'UTC',
      enableIdleTimeout: u?.enableIdleTimeout ?? true,
      groups:            u?.groups         ?? [],
    };
  });

  if (!includeDetail) return { shifts: expandedShifts, users };

  // ── 4. Attendance inputs (2–3 Firestore reads total) ────────────────
  const now = Date.now();
  const BUFFER_MS = 4 * 60 * 60 * 1000; // sessions that started before the shift

  const [ledgerByUser, activeSessions] = await Promise.all([
    getLedgerEntriesForUsers([...eligibleUserIds], windowStartMs - BUFFER_MS, windowEndMs),
    getActiveSessionsForUsers([...eligibleUserIds]),
  ]);

  // ── 5. Leave requests falling in the window ─────────────────────────
  //
  // Queried by `occurrenceStart` range, **not** by the shift ids the window
  // expanded to. A pending request pins the shift id it was submitted against,
  // and every admin edit path re-homes the occurrence onto a new document — so
  // an `in` over the current ids is exactly the query that cannot see the
  // request that needs seeing. `occurrenceStart` is a plain single-field range
  // (no composite index, and the field is not exempted), and it is one query
  // instead of a chunked fan-out over 30 ids at a time.
  type LeaveInfo = { leaveId: string; leaveType: 'paid' | 'unpaid'; status: 'pending' | 'approved' | 'denied'; userId: string; shiftId: string; occurrenceStart: number };
  const allLeaveDocs: LeaveInfo[] = [];
  {
    const snap = await adminDb
      .collection('leave_requests')
      .where('occurrenceStart', '>=', windowStartMs)
      .where('occurrenceStart', '<=', windowEndMs)
      .get();
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!eligibleUserIds.has(d.userId)) continue;
      allLeaveDocs.push({
        leaveId: d.leaveId,
        leaveType: d.leaveType,
        status: d.status,
        userId: d.userId,
        shiftId: d.shiftId,
        occurrenceStart: d.occurrenceStart,
      });
    }
  }

  // Tiered match rather than a strict tuple lookup — see `leaveMatch.ts` for
  // why, and for where it deliberately refuses to guess.
  const leaveMap = matchLeaveToOccurrences(allLeaveDocs, expandedShifts);

  const shifts = expandedShifts.map(s => {
    const shiftStartMs = s.occurrenceStart;
    const shiftEndMs   = s.occurrenceEnd;
    const isPast       = shiftEndMs <= now;
    const isCurrent    = shiftStartMs <= now && shiftEndMs > now;

    const sessions      = ledgerByUser.get(s.userId) ?? [];
    const activeSession = activeSessions.get(s.userId);

    let timeWorkedSeconds: number | null = null;
    let attendanceStatus: 'on-time' | 'late' | 'absent' | null = null;

    if (isPast || isCurrent) {
      const effectiveEnd = isPast ? shiftEndMs : now;
      timeWorkedSeconds = computeTimeWorked(shiftStartMs, effectiveEnd, sessions, activeSession);
      attendanceStatus  = computeAttendance(shiftStartMs, shiftEndMs, sessions, activeSession);
    }

    const leaveEntry = leaveMap.get(occurrenceKey(s));
    const leaveRequest = leaveEntry
      ? { leaveId: leaveEntry.leaveId, leaveType: leaveEntry.leaveType, status: leaveEntry.status }
      : null;

    return { ...s, timeWorkedSeconds, attendanceStatus, leaveRequest };
  });

  return { shifts, users };
}
