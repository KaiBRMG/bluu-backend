import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById, getAllTimeTrackingUsers } from '@/lib/services/userService';
import { adminDb } from '@/lib/firebase-admin';
import { getShiftsByRange, getLedgerEntriesForUsers } from '@/lib/services/shiftService';
import { expandShiftsForWindow } from '@/lib/utils/recurrence';
import { serialiseShift } from '@/lib/utils/shiftSerialise';
import { matchLeaveToOccurrences, occurrenceKey } from '@/lib/utils/leaveMatch';
import { computeAttendanceDetail } from '@/lib/utils/shiftAttendance';
import { eventsToSegments } from '@/lib/utils/sessionSegments';
import {
  safeTimezone,
  todayStr,
  addCalendarDays,
  getDayBoundsUTC,
} from '@/lib/utils/timezone';
import {
  type OverviewPerson,
  type OverviewSession,
  type OverviewShift,
  type SettledFlag,
  type ShiftOverviewResponse,
} from '@/lib/shiftOverview';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ActiveSessionDocument } from '@/types/firestore';

/**
 * GET /api/admin/shift-management/overview
 *
 * The settled half of Shift Management's "Needs attention" queue and today
 * strip, over yesterday → tomorrow in the CALLER's timezone. The live half
 * (idle, break length, a silent app) is derived client-side from the
 * `active_sessions` snapshot the page already holds — see `lib/shiftOverview.ts`.
 *
 * Reads, in two parallel rounds: shifts (2 queries), the time-tracking roster
 * (1 query) and leave requests (1 range query); then the ledger for the window
 * (1 query per 30 users) and open sessions (1 query — billed per clocked-in
 * person, not per roster member). The same set `/api/shifts/week` reads, over
 * three days instead of seven. Never reads `time_entries` outside the window.
 *
 * Tier: the `shift-management` page permission, matching `/api/shifts/week` and
 * the analytics route — this exposes nothing those two do not.
 *
 * Cache: per-user, so `private` + `Vary: Authorization` (rule 9i). One minute:
 * long enough to absorb a remount, short enough that "missed a shift" is fresh.
 */

const BUFFER_MS = 4 * 60 * 60 * 1000; // sessions that began before the window but overlap it

type RosterUser = {
  uid?: string;
  displayName?: string;
  photoURL?: string | null;
  isArchived?: boolean;
};

export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const tz = safeTimezone(caller.timezone);
    const now = Date.now();
    const today = todayStr(tz);
    const yesterday = addCalendarDays(today, -1);
    const tomorrow = addCalendarDays(today, 1);
    const todayBounds = getDayBoundsUTC(today, tz);
    const yesterdayBounds = getDayBoundsUTC(yesterday, tz);
    const windowStart = yesterdayBounds.start;
    const windowEnd = getDayBoundsUTC(tomorrow, tz).end;

    const [rawShifts, roster, leaveSnap] = await Promise.all([
      getShiftsByRange(windowStart, windowEnd),
      getAllTimeTrackingUsers() as Promise<RosterUser[]>,
      adminDb
        .collection('leave_requests')
        .where('occurrenceStart', '>=', windowStart)
        .where('occurrenceStart', '<=', windowEnd)
        .get(),
    ]);

    const people: OverviewPerson[] = [];
    for (const u of roster) {
      if (!u?.uid || u.isArchived === true) continue;
      people.push({
        uid: u.uid,
        displayName: u.displayName || 'User',
        photoURL: u.photoURL ?? null,
      });
    }
    const ids = people.map(p => p.uid);
    const eligible = new Set(ids);

    const [ledgerByUser, activeSnap] = await Promise.all([
      getLedgerEntriesForUsers(ids, windowStart - BUFFER_MS, now),
      // The same query `useActiveUsers` listens on: one read per open session.
      adminDb.collection('active_sessions').where('userClockOut', '==', false).get(),
    ]);
    const activeByUser = new Map<string, ActiveSessionDocument>();
    for (const doc of activeSnap.docs) {
      const d = doc.data() as ActiveSessionDocument;
      if (eligible.has(d.userId)) activeByUser.set(d.userId, d);
    }

    // ── Shift occurrences ──────────────────────────────────────────
    const expanded = expandShiftsForWindow(
      rawShifts
        .filter(s => eligible.has(s.userId))
        .map(s => ({ ...serialiseShift(s), timeWorkedSeconds: null, attendanceStatus: null })),
      windowStart,
      windowEnd,
    );

    type LeaveInfo = {
      leaveId: string; leaveType: 'paid' | 'unpaid'; status: 'pending' | 'approved' | 'denied';
      userId: string; shiftId: string; occurrenceStart: number;
    };
    const leaveDocs: LeaveInfo[] = [];
    for (const doc of leaveSnap.docs) {
      const d = doc.data();
      if (!eligible.has(d.userId)) continue;
      leaveDocs.push({
        leaveId: d.leaveId, leaveType: d.leaveType, status: d.status,
        userId: d.userId, shiftId: d.shiftId, occurrenceStart: d.occurrenceStart,
      });
    }
    const leaveMap = matchLeaveToOccurrences(leaveDocs, expanded);

    const shifts: OverviewShift[] = expanded.map(s => {
      const started = s.occurrenceStart <= now;
      const detail = started
        ? computeAttendanceDetail(
            s.occurrenceStart, s.occurrenceEnd, ledgerByUser.get(s.userId) ?? [], activeByUser.get(s.userId),
          )
        : null;
      const leave = leaveMap.get(occurrenceKey(s));
      return {
        key: `${s.shiftId}:${s.occurrenceStart}`,
        userId: s.userId,
        start: s.occurrenceStart,
        end: s.occurrenceEnd,
        attendance: detail?.status ?? null,
        clockInMs: detail?.firstClockInMs ?? null,
        leave: leave ? { status: leave.status, type: leave.leaveType } : null,
      };
    });

    // ── Sessions (today strip) + settled flags ─────────────────────
    const sessions: OverviewSession[] = [];
    const flags: SettledFlag[] = [];

    for (const uid of ids) {
      const ledger = ledgerByUser.get(uid) ?? [];
      let yWorking = 0;
      let yBreak = 0;

      for (const s of ledger) {
        // Per-person guard: one malformed doc must not 500 the roster (time-tracking.md trap 9).
        try {
          const start = s.startTime.toMillis();
          const end = s.endTime.toMillis();

          if (end > todayBounds.start && start < todayBounds.end) {
            sessions.push({
              sessionId: s.sessionId,
              userId: uid,
              start,
              end,
              spans: eventsToSegments(s.eventLog, start, end).map(sp => [sp.startMs, sp.endMs, sp.state]),
            });
          }

          // Discriminate on status, never didNotClockOut (trap 3). An interrupted
          // session with an empty log is the crash default — its hours are unknown,
          // which is exactly why it needs a person to look.
          if (s.status === 'interrupted' && start >= windowStart) {
            flags.push({ kind: 'missed-clock-out', userId: uid, sessionId: s.sessionId, start, end });
          }

          if (start >= yesterdayBounds.start && start < yesterdayBounds.end && !s.isManual) {
            yWorking += s.workingSeconds ?? 0;
            yBreak += s.breakSeconds ?? 0;
          }
        } catch (err) {
          console.error('[shift-management/overview] skipped session', s?.sessionId, err);
        }
      }

      if (yWorking >= 4 * 3600 && yBreak === 0) {
        flags.push({ kind: 'no-break', userId: uid, date: yesterday, workingSeconds: yWorking });
      }

    }

    const body: ShiftOverviewResponse = {
      generatedAt: now,
      timezone: tz,
      today,
      yesterday,
      todayBounds,
      people,
      shifts,
      sessions,
      flags,
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'private, max-age=60', Vary: 'Authorization' },
    });
  } catch (err) {
    console.error('[shift-management/overview GET]', err);
    return NextResponse.json({ error: 'Failed to load the overview' }, { status: 500 });
  }
});
