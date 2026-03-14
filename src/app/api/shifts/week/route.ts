import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById, getAllTimeTrackingUsers } from '@/lib/services/userService';
import { adminDb } from '@/lib/firebase-admin';
import {
  getShiftsByRange,
  getShiftsByUserAndRange,
  getLedgerEntriesForUsers,
  getActiveSessionsForUsers,
} from '@/lib/services/shiftService';
import { computeWorkedInWindow } from '@/lib/utils/sessionSegments';
import { expandShiftsForWindow } from '@/lib/utils/recurrence';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import type { ShiftDocument, TimeEntryLedgerDocument, ActiveSessionDocument } from '@/types/firestore';

// ─── Helpers ─────────────────────────────────────────────────────────

function serialiseRecurrence(r: ShiftDocument['recurrence']) {
  if (!r) return null;
  return {
    ...r,
    endDate: r.endDate ? r.endDate.toDate().toISOString() : null,
  };
}

function serialiseShift(s: ShiftDocument) {
  return {
    shiftId:        s.shiftId,
    userId:         s.userId,
    startTime:      s.startTime.toDate().toISOString(),
    endTime:        s.endTime.toDate().toISOString(),
    wallClockStart: s.wallClockStart,
    wallClockEnd:   s.wallClockEnd,
    userTimezone:   s.userTimezone,
    isRecurring:    s.isRecurring,
    recurrence:     serialiseRecurrence(s.recurrence),
    seriesId:       s.seriesId,
    overrideDate:   s.overrideDate ? s.overrideDate.toDate().toISOString() : null,
    isDeleted:      s.isDeleted,
  };
}

// Attendance thresholds (hardcoded per spec)
const ON_TIME_BEFORE_MS = 15 * 60 * 1000;   // 15 min before shift start
const LATE_AFTER_MS     = 30 * 60 * 1000;   // 30 min after shift start

function computeAttendance(
  shiftStartMs: number,
  shiftEndMs: number,
  sessions: TimeEntryLedgerDocument[],
  activeSession: ActiveSessionDocument | undefined,
): 'on-time' | 'late' | 'absent' {
  const onTimeFrom  = shiftStartMs - ON_TIME_BEFORE_MS;
  const lateThresh  = shiftStartMs + LATE_AFTER_MS;

  // Collect all clock-in times (completed sessions + active session)
  const clockIns: number[] = [];

  for (const s of sessions) {
    const t = s.startTime.toMillis();
    if (t >= onTimeFrom && t <= shiftEndMs) clockIns.push(t);
  }

  if (activeSession) {
    const t = activeSession.startTime.toMillis();
    if (t >= onTimeFrom && t <= shiftEndMs) clockIns.push(t);
  }

  if (clockIns.length === 0) return 'absent';

  const first = Math.min(...clockIns);
  return first <= lateThresh ? 'on-time' : 'late';
}

function computeTimeWorked(
  shiftStartMs: number,
  shiftEndMs: number,
  sessions: TimeEntryLedgerDocument[],
  activeSession: ActiveSessionDocument | undefined,
  includeIdleTime: boolean,
): number {
  let total = 0;

  for (const s of sessions) {
    const sessionStartMs = s.startTime.toMillis();
    const sessionEndMs   = s.endTime.toMillis();
    // Skip sessions that don't overlap the shift window
    if (sessionEndMs <= shiftStartMs || sessionStartMs >= shiftEndMs) continue;

    total += computeWorkedInWindow(
      s.eventLog,
      sessionStartMs,
      sessionEndMs,
      shiftStartMs,
      shiftEndMs,
      includeIdleTime,
    );
  }

  // If there's an active (not yet clocked out) session overlapping the shift
  if (activeSession && !activeSession.userClockOut) {
    const sessionStartMs = activeSession.startTime.toMillis();
    const sessionEndMs   = Math.min(Date.now(), shiftEndMs);
    if (sessionEndMs > shiftStartMs && sessionStartMs < shiftEndMs) {
      // No eventLog available for active sessions — count all time as working
      const clippedStart = Math.max(sessionStartMs, shiftStartMs);
      const clippedEnd   = Math.min(sessionEndMs,   shiftEndMs);
      if (clippedEnd > clippedStart) {
        total += Math.round((clippedEnd - clippedStart) / 1000);
      }
    }
  }

  return total;
}

// ─── GET /api/shifts/week ─────────────────────────────────────────────
// ?weekStart=YYYY-MM-DD  (Monday of the week, UTC)
// &userId=uid            (optional — restrict to one user)

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const weekStartStr = searchParams.get('weekStart');
    const filterUserId = searchParams.get('userId') ?? null;

    if (!weekStartStr) {
      return NextResponse.json({ error: 'weekStart required (YYYY-MM-DD)' }, { status: 400 });
    }

    // Compute week window: Mon 00:00 UTC → Sun 23:59:59.999 UTC
    const [wy, wm, wd] = weekStartStr.split('-').map(Number);
    const weekStartMs  = Date.UTC(wy, wm - 1, wd, 0, 0, 0, 0);
    const weekEndMs    = Date.UTC(wy, wm - 1, wd + 6, 23, 59, 59, 999);

    if (isNaN(weekStartMs)) {
      return NextResponse.json({ error: 'Invalid weekStart format' }, { status: 400 });
    }

    // ── 1. Fetch all shifts for the week (1–2 Firestore queries) ──────
    const rawShifts = filterUserId
      ? await getShiftsByUserAndRange(filterUserId, weekStartMs, weekEndMs)
      : await getShiftsByRange(weekStartMs, weekEndMs);

    // ── 2. Fetch ALL time-tracking users (one query) + any extra users
    //       referenced by shifts but not yet in that set ─────────────────
    const shiftUserIds = [...new Set(rawShifts.map(s => s.userId))];
    const shiftUserRefs = shiftUserIds.map(uid => adminDb.collection('users').doc(uid));

    const [allTtUsers, shiftUserSnaps] = await Promise.all([
      getAllTimeTrackingUsers(),
      shiftUserIds.length > 0
        ? adminDb.getAll(...shiftUserRefs)
        : Promise.resolve([] as DocumentSnapshot[]),
    ]);

    const shiftUserDocs = shiftUserSnaps.map((snap, i) => ({
      uid: shiftUserIds[i],
      user: snap.exists ? snap.data() : null,
    }));

    // Build a unified map: uid → user doc
    const userMap = new Map<string, any>();
    for (const u of allTtUsers) {
      if (u?.uid) userMap.set(u.uid, u);
    }
    for (const { uid, user } of shiftUserDocs) {
      if (!userMap.has(uid) && user?.permittedPageIds?.includes('time-tracking')) userMap.set(uid, user);
    }

    // All eligible (time-tracking permitted) user IDs
    const eligibleUserIds = new Set(userMap.keys());

    // ── 3. Batch-fetch time_entries + active_sessions (2–3 Firestore reads total) ──
    const now = Date.now();
    const BUFFER_MS = 4 * 60 * 60 * 1000; // 4h before window for sessions that started before shift

    const [ledgerByUser, activeSessions] = await Promise.all([
      getLedgerEntriesForUsers(
        [...eligibleUserIds],
        weekStartMs - BUFFER_MS,
        weekEndMs,
      ),
      getActiveSessionsForUsers([...eligibleUserIds]),
    ]);

    // ── 4. Build response ─────────────────────────────────────────────
    // Serialise raw shifts for expansion (recurrence.ts works with ISO strings)
    const eligibleRaw = rawShifts
      .filter(s => eligibleUserIds.has(s.userId))
      .map(s => ({
        ...serialiseShift(s),
        timeWorkedSeconds: null as number | null,
        attendanceStatus: null as 'on-time' | 'late' | 'absent' | null,
      }));

    // Expand recurring roots into per-occurrence entries server-side so that
    // attendance and time-worked are computed against each occurrence's actual
    // start/end time (not the root document's original timestamp).
    const expandedShifts = expandShiftsForWindow(eligibleRaw, weekStartMs, weekEndMs);

    // ── 5. Fetch leave requests for all shift IDs in the week ─────────
    const shiftIds = [...new Set(expandedShifts.map(s => s.shiftId))];
    type LeaveInfo = { leaveId: string; leaveType: 'paid' | 'unpaid'; status: 'pending' | 'approved' | 'denied'; userId: string };
    const leaveMap = new Map<string, LeaveInfo>();

    if (shiftIds.length > 0) {
      const CHUNK_SIZE = 30;
      const allLeaveDocs: LeaveInfo[] = [];
      for (let i = 0; i < shiftIds.length; i += CHUNK_SIZE) {
        const chunk = shiftIds.slice(i, i + CHUNK_SIZE);
        const snap = await adminDb
          .collection('leave_requests')
          .where('shiftId', 'in', chunk)
          .get();
        for (const doc of snap.docs) {
          const d = doc.data();
          allLeaveDocs.push({
            leaveId: d.leaveId,
            leaveType: d.leaveType,
            status: d.status,
            userId: d.userId,
            // occurrenceStart used as part of the key below
            ...d,
          });
        }
      }
      for (const lr of allLeaveDocs) {
        leaveMap.set(`${lr.shiftId}:${lr.occurrenceStart}:${lr.userId}`, lr);
      }
    }

    const serialisedShifts = expandedShifts.map(s => {
      const shiftStartMs = s.occurrenceStart;
      const shiftEndMs   = s.occurrenceEnd;
      const isPast       = shiftEndMs <= now;
      const isCurrent    = shiftStartMs <= now && shiftEndMs > now;

      const sessions       = ledgerByUser.get(s.userId) ?? [];
      const activeSession  = activeSessions.get(s.userId);

      let timeWorkedSeconds: number | null = null;
      let attendanceStatus: 'on-time' | 'late' | 'absent' | null = null;

      if (isPast || isCurrent) {
        const effectiveEnd = isPast ? shiftEndMs : now;
        timeWorkedSeconds = computeTimeWorked(
          shiftStartMs, effectiveEnd, sessions, activeSession,
          userMap.get(s.userId)?.includeIdleTime ?? false,
        );
        attendanceStatus = computeAttendance(
          shiftStartMs, shiftEndMs, sessions, activeSession,
        );
      }

      const leaveEntry = leaveMap.get(`${s.shiftId}:${s.occurrenceStart}:${s.userId}`);
      const leaveRequest = leaveEntry
        ? { leaveId: leaveEntry.leaveId, leaveType: leaveEntry.leaveType, status: leaveEntry.status }
        : null;

      return { ...s, timeWorkedSeconds, attendanceStatus, leaveRequest };
    });

    const users = [...eligibleUserIds].map(uid => {
      const u = userMap.get(uid);
      return {
        uid,
        displayName:    u?.displayName    ?? uid,
        photoURL:       u?.photoURL       ?? null,
        timezone:       u?.timezone       ?? 'UTC',
        includeIdleTime: u?.includeIdleTime ?? false,
        groups:         u?.groups         ?? [],
      };
    });

    return NextResponse.json({ shifts: serialisedShifts, users });
  } catch (err) {
    console.error('[shifts/week GET]', err);
    return NextResponse.json({ error: 'Failed to fetch week shifts' }, { status: 500 });
  }
});
