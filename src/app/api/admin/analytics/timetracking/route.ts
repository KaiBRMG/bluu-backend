import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import { getAllTimeTrackingUsers } from '@/lib/services/userService';
import { getAllGroups } from '@/lib/services/groupService';
import { getShiftsByRange } from '@/lib/services/shiftService';
import {
  getRollupsForUser,
  getRollupsForUsers,
  getRollupsByDateRange,
} from '@/lib/services/analyticsService';
import { expandShiftsForWindow } from '@/lib/utils/recurrence';
import { serialiseShift } from '@/lib/utils/shiftSerialise';
import { aggregateAnalytics, type ShiftOccurrence } from '@/lib/utils/analyticsAggregate';
import { getDayBoundsUTC, toLocalDateStr, todayStr, addCalendarDays } from '@/lib/utils/timezone';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { AnalyticsDailyDocument } from '@/types/firestore';

/** The fields of a user doc this route actually reads. */
interface RosterUser {
  uid: string;
  displayName?: string;
  photoURL?: string | null;
  timezone?: string;
  isArchived?: boolean;
}

/** The fields of a group doc this route actually reads. */
interface RosterGroup {
  groupId?: string;
  id?: string;
  name?: string;
  members?: string[];
}

/**
 * GET /api/admin/analytics/timetracking
 *   ?scope=user|group|company
 *   &entityId=<uid|groupId>      (required for user/group)
 *   &start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Reads precomputed analytics_daily rollups (written nightly by the
 * rollupDailyAnalytics Cloud Function) and folds them server-side, so the
 * response is small and flat regardless of how many user-days it covers.
 */

const MAX_RANGE_DAYS = 90;
/** Days of lookback used ONLY to seed consecutive-day streaks. */
const STREAK_SEED_DAYS = 7;
/**
 * Above this roster size, one date-range scan beats chunked `userId in` queries
 * (which cost ceil(n/30) round trips over the same index). Below it, the
 * targeted query reads fewer documents.
 */
const IN_CHUNK_BREAKEVEN = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(start: string, end: string): number {
  const toDay = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  };
  return toDay(end) - toDay(start) + 1;
}

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, 'shift-management');
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const scope    = searchParams.get('scope') ?? 'company';
    const entityId = searchParams.get('entityId');
    const start    = searchParams.get('start');
    let   end      = searchParams.get('end');

    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: 'start and end are required (YYYY-MM-DD)' }, { status: 400 });
    }
    if (scope !== 'user' && scope !== 'group' && scope !== 'company') {
      return NextResponse.json({ error: 'scope must be user, group or company' }, { status: 400 });
    }
    if ((scope === 'user' || scope === 'group') && !entityId) {
      return NextResponse.json({ error: `entityId is required for scope=${scope}` }, { status: 400 });
    }

    // Rollups only ever exist for completed local days, so a range reaching into
    // today would silently read as zero rather than "not computed yet".
    const yesterday = addCalendarDays(todayStr('UTC'), -1);
    if (end > yesterday) end = yesterday;
    if (start > end) {
      return NextResponse.json({
        error: 'Range is entirely in the future — analytics are computed nightly and end yesterday.',
      }, { status: 400 });
    }

    // Enforced server-side, not just in the UI: an unbounded range would scan
    // the whole collection.
    const span = daysBetween(start, end);
    if (span > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Range too large: ${span} days (max ${MAX_RANGE_DAYS})` },
        { status: 400 },
      );
    }

    const seedStart = addCalendarDays(start, -STREAK_SEED_DAYS);

    // ── 1. Resolve the roster ─────────────────────────────────────────
    const allUsers = (await getAllTimeTrackingUsers()) as RosterUser[];
    const activeUsers = new Map<string, RosterUser>();
    for (const u of allUsers) {
      // Archived users are excluded from current views, but their rollups are
      // retained so historical totals stay correct.
      if (u?.uid && u.isArchived !== true) activeUsers.set(u.uid, u);
    }

    let targetUserIds: string[];
    let entityName = 'Company';

    if (scope === 'user') {
      if (!activeUsers.has(entityId!)) {
        return NextResponse.json({ error: 'User not found or not time-tracked' }, { status: 404 });
      }
      targetUserIds = [entityId!];
      entityName = activeUsers.get(entityId!)?.displayName ?? entityId!;
    } else if (scope === 'group') {
      const groups = (await getAllGroups()) as RosterGroup[];
      const group = groups.find(g => g.groupId === entityId || g.id === entityId);
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      const members: string[] = Array.isArray(group.members) ? group.members : [];
      // Membership is read as-of-NOW, not as-of-then — moving someone between
      // groups retroactively re-attributes their history. This is what people
      // expect from "show me the CA team's last 90 days"; it is surfaced in the UI.
      targetUserIds = members.filter(uid => activeUsers.has(uid));
      entityName = group.name ?? group.groupId ?? entityId!;
    } else {
      targetUserIds = [...activeUsers.keys()];
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json({
        range: { start, end }, scope, entity: { id: entityId ?? 'company', name: entityName },
        ...aggregateAnalytics([], [], []),
        users: [],
      });
    }

    // ── 2. Fetch rollups ──────────────────────────────────────────────
    const targetSet = new Set(targetUserIds);
    let allRollups: AnalyticsDailyDocument[];

    if (scope === 'user') {
      allRollups = await getRollupsForUser(entityId!, seedStart, end);
    } else if (scope === 'company' && activeUsers.size > IN_CHUNK_BREAKEVEN) {
      // One date-range query beats fanning out `userId in` chunks across the
      // whole roster; archived users are filtered in memory.
      const raw = await getRollupsByDateRange(seedStart, end);
      allRollups = raw.filter(r => targetSet.has(r.userId));
    } else {
      allRollups = await getRollupsForUsers(targetUserIds, seedStart, end);
    }

    const rollups     = allRollups.filter(r => r.date >= start);
    const seedRollups = allRollups.filter(r => r.date < start);

    // ── 3. Expand shifts for adherence ────────────────────────────────
    // Rollups store a per-day timeline, so adherence is computed here rather
    // than baked in — editing a shift retroactively fixes adherence with no
    // rollup recompute.
    const windowStartMs = getDayBoundsUTC(start, 'UTC').start - 24 * 3600 * 1000;
    const windowEndMs   = getDayBoundsUTC(end,   'UTC').end   + 24 * 3600 * 1000;

    const rawShifts = await getShiftsByRange(windowStartMs, windowEndMs);
    const eligible = rawShifts
      .filter(s => targetSet.has(s.userId))
      .map(s => ({
        ...serialiseShift(s),
        // Payload fields RawApiShift carries for the shift grid; the expander
        // never reads them, and adherence is computed from rollups below.
        timeWorkedSeconds: null,
        attendanceStatus: null,
      }));

    const expanded = expandShiftsForWindow(eligible, windowStartMs, windowEndMs);

    const shiftOccurrences: ShiftOccurrence[] = [];
    for (const s of expanded) {
      const tz = activeUsers.get(s.userId)?.timezone ?? 'UTC';
      const localDate = toLocalDateStr(s.occurrenceStart, tz);
      // Keep only occurrences whose local date falls inside the requested range.
      if (localDate < start || localDate > end) continue;
      shiftOccurrences.push({
        userId: s.userId,
        occurrenceStart: s.occurrenceStart,
        occurrenceEnd: s.occurrenceEnd,
        localDate,
      });
    }

    // ── 4. Aggregate ──────────────────────────────────────────────────
    const result = aggregateAnalytics(rollups, seedRollups, shiftOccurrences);

    const users = result.byUser.map(u => ({
      ...u,
      displayName: activeUsers.get(u.userId)?.displayName ?? u.userId,
      photoURL: activeUsers.get(u.userId)?.photoURL ?? null,
    }));

    return NextResponse.json(
      {
        range: { start, end },
        scope,
        entity: { id: entityId ?? 'company', name: entityName },
        rosterSize: targetUserIds.length,
        ...result,
        byUser: users,
      },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (err) {
    console.error('[admin/analytics/timetracking GET]', err);
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
});
