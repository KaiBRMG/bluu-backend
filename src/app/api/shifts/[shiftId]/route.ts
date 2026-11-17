import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import {
  updateShift,
  deleteShift,
  deleteShiftSeries,
  createOccurrenceOverride,
  deleteOccurrence,
  truncateSeriesAt,
  commitSeriesSplit,
  getLeaveForSplit,
} from '@/lib/services/shiftService';
import { adminDb } from '@/lib/firebase-admin';
import type { Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { normaliseAccountIds, intersectOvertimeIds } from '@/lib/services/creatorAccountService';
import { findSeriesSplitAtDate } from '@/lib/utils/recurrence';
import { docsMovedBySplit, leavesMovedBySplit, remainingCount } from '@/lib/shifts/seriesSplitPlan';
import type { ShiftDocument, ShiftRecurrence } from '@/types/firestore';
import { queueOvertimeAssignedForShift } from '@/lib/services/coverageNotices';

// ─── PUT /api/shifts/[shiftId] ───────────────────────────────────────

export const PUT = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ shiftId: string }> | { shiftId: string },
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { shiftId } = await Promise.resolve(params);
    const body = await request.json();

    // Fetch the existing shift to validate it exists and get series info
    const shiftDoc = await adminDb.collection('shifts').doc(shiftId).get();
    if (!shiftDoc.exists) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }
    const existing = shiftDoc.data() as ShiftDocument;

    const {
      userId, startTime, endTime, wallClockStart, wallClockEnd, userTimezone, recurrence,
      // Recurrence scope modifiers
      saveMode,       // 'single' | 'future' — for recurring edits
      overrideDate,   // ISO string — required when saveMode is 'single' or 'future'
      creatorIds,     // creator accounts this shift covers — sets the wage tier
      overtimeCreatorIds, // the subset of those worked as unpaid in-shift overtime
    } = body;

    // Validated against the live roster before any branch below writes it: the
    // assignment's *count* is what pays the agent, so an unresolvable id must
    // fail the request rather than quietly becoming a wage tier.
    let assignedCreatorIds: string[] | undefined;
    let assignedOvertimeIds: string[] | undefined;
    if ('creatorIds' in body) {
      const assigned = await normaliseAccountIds(creatorIds, undefined, existing.creatorIds ?? []);
      if (assigned.invalid.length > 0) {
        return NextResponse.json(
          {
            // Almost always a stale picker: the account was archived or deleted
            // while this page had the roster cached. Say so, rather than printing
            // a raw id the admin cannot look up.
            error:
              `${assigned.invalid.length === 1 ? 'An account' : 'Some accounts'} in this assignment no longer exist` +
              ` (${assigned.invalid.join(', ')}). They may have been archived or deleted — reload the page and pick again.`,
          },
          { status: 400 },
        );
      }
      assignedCreatorIds = assigned.accountIds;
      // Always recomputed alongside the assignment, never on its own: the two
      // are one fact, and an overtime id left pointing at an account that was
      // just removed would subtract a tier for work nobody does.
      assignedOvertimeIds = intersectOvertimeIds(assigned.accountIds, overtimeCreatorIds);
    }

    const startMs = startTime ? new Date(startTime).getTime() : null;
    const endMs   = endTime   ? new Date(endTime).getTime()   : null;

    if (startMs !== null && endMs !== null && endMs <= startMs) {
      return NextResponse.json({ error: 'endTime must be after startTime' }, { status: 400 });
    }

    // Validate target user if changing userId
    if (userId && userId !== existing.userId) {
      const targetUser = await getUserById(userId);
      if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
      if (!targetUser.permittedPageIds?.includes('time-tracking')) return NextResponse.json({ error: 'User does not have time tracking enabled' }, { status: 400 });
    }

    if (existing.isRecurring && saveMode === 'single') {
      // Create an override doc for this specific occurrence
      if (!overrideDate) {
        return NextResponse.json({ error: 'overrideDate required for single-occurrence edit' }, { status: 400 });
      }
      const overrideDateMs = new Date(overrideDate).getTime();

      await createOccurrenceOverride(
        existing.seriesId ?? shiftId, // if this is already an override, link to the root
        overrideDateMs,
        {
          userId:         userId         ?? existing.userId,
          startTime:      startMs        ?? existing.startTime.toMillis(),
          endTime:        endMs          ?? existing.endTime.toMillis(),
          wallClockStart: wallClockStart ?? existing.wallClockStart,
          wallClockEnd:   wallClockEnd   ?? existing.wallClockEnd,
          userTimezone:   userTimezone   ?? existing.userTimezone,
          createdBy:      token.uid,
          recurrence:     null,
          creatorIds:     assignedCreatorIds ?? existing.creatorIds ?? [],
          overtimeCreatorIds: assignedOvertimeIds ?? existing.overtimeCreatorIds ?? [],
          isOvertime:     existing.isOvertime ?? false,
          coverageOfferId: existing.coverageOfferId ?? null,
          paysWage:       existing.paysWage ?? true,
        },
      );
    } else if (existing.isRecurring && saveMode === 'future') {
      // Split the series at the chosen occurrence: the old root stops the day
      // before, a new root carries the edit from there. A real split, not just
      // truncate + create: `count` carries over, and the exceptions and released
      // leave dated from the split move with it (see `seriesSplitPlan.ts`).
      if (!overrideDate) {
        return NextResponse.json({ error: 'overrideDate required for future edit' }, { status: 400 });
      }
      const overrideDateMs = new Date(overrideDate).getTime();
      if (!Number.isFinite(overrideDateMs) || existing.seriesId || !existing.recurrence) {
        // "This and future" is only offered on an occurrence of a root.
        return NextResponse.json({ error: 'This shift cannot be edited from this date onward' }, { status: 400 });
      }
      const rootId = shiftId;

      // `overrideDate` is UTC midnight of the occurrence's local date.
      const chosenDate = new Date(overrideDateMs).toISOString().slice(0, 10);
      const split = findSeriesSplitAtDate(
        {
          startTimeMs: existing.startTime.toMillis(),
          wallClockStart: existing.wallClockStart,
          wallClockEnd: existing.wallClockEnd,
          userTimezone: existing.userTimezone,
          recurrence: existing.recurrence,
        },
        chosenDate,
      );
      if (!split || split.date !== chosenDate) {
        return NextResponse.json(
          { error: 'That occurrence is no longer part of this series. Reload the page and try again.' },
          { status: 409 },
        );
      }

      // A count is the series' total, so the new root runs what is left of it.
      let newRecurrence = (recurrence !== undefined ? recurrence : existing.recurrence) as ShiftRecurrence | null;
      if (newRecurrence && typeof newRecurrence.count === 'number') {
        const remaining = remainingCount(newRecurrence.count, split.before);
        if (remaining === null || remaining <= 0) {
          return NextResponse.json(
            {
              error:
                `This series has already run ${split.before} occurrence${split.before === 1 ? '' : 's'} before this date, ` +
                `so ending after ${newRecurrence.count} leaves none from here. Raise the count, or delete this and future shifts instead.`,
            },
            { status: 400 },
          );
        }
        newRecurrence = { ...newRecurrence, count: remaining, parentShiftId: null };
      }

      // Handing the series to another agent? The outgoing agent's own edits,
      // deletions and released leave stay on their series, not the new one.
      const newAgent = userId ?? existing.userId;
      const outgoingAgent = newAgent !== existing.userId ? existing.userId : undefined;

      const [overridesSnap, leaves] = await Promise.all([
        adminDb.collection('shifts').where('seriesId', '==', rootId).get(),
        getLeaveForSplit(split.occurrenceStart),
      ]);
      const moved = docsMovedBySplit(
        overridesSnap.docs.map(d => ({
          shiftId: d.id,
          userId: d.get('userId') as string,
          seriesId: d.get('seriesId') as string | null,
          overrideDateMs: (d.get('overrideDate') as Timestamp | null)?.toMillis() ?? null,
        })),
        rootId,
        split.overrideDateMs,
        outgoingAgent,
      );

      await commitSeriesSplit({
        rootId,
        truncateAtMs: split.overrideDateMs,
        newRoot: {
          userId:         newAgent,
          startTime:      startMs        ?? split.occurrenceStart,
          endTime:        endMs          ?? split.occurrenceEnd,
          wallClockStart: wallClockStart ?? existing.wallClockStart,
          wallClockEnd:   wallClockEnd   ?? existing.wallClockEnd,
          userTimezone:   userTimezone   ?? existing.userTimezone,
          createdBy:      token.uid,
          recurrence:     newRecurrence,
          creatorIds:     assignedCreatorIds ?? existing.creatorIds ?? [],
          overtimeCreatorIds: assignedOvertimeIds ?? existing.overtimeCreatorIds ?? [],
          isOvertime:     existing.isOvertime ?? false,
          coverageOfferId: existing.coverageOfferId ?? null,
          paysWage:       existing.paysWage ?? true,
        },
        repoint: moved.map(o => ({ shiftId: o.shiftId })),
        leaves: leavesMovedBySplit(leaves, rootId, split.occurrenceStart, outgoingAgent),
      });
    } else {
      // Plain update (non-recurring, or updating the whole series)
      await updateShift(shiftId, {
        ...(userId         !== undefined && { userId }),
        ...(startMs        !== null      && { startTime: startMs }),
        ...(endMs          !== null      && { endTime: endMs }),
        ...(wallClockStart !== undefined && { wallClockStart }),
        ...(wallClockEnd   !== undefined && { wallClockEnd }),
        ...(userTimezone   !== undefined && { userTimezone }),
        ...('recurrence' in body        && { recurrence: body.recurrence }),
        ...(assignedCreatorIds !== undefined && { creatorIds: assignedCreatorIds }),
        ...(assignedOvertimeIds !== undefined && { overtimeCreatorIds: assignedOvertimeIds }),
      });
    }

    // ── Tell the agent about overtime they did not have before ──
    //
    // Only the *newly* overtime accounts, diffed against what the shift already
    // carried: an admin moving a shift by an hour must not re-announce cover the
    // agent was told about last week. Reassigning the shift to a different agent
    // makes every overtime account new *to them*, which the diff would otherwise
    // miss — the previous holder's marks say nothing about what this person knows.
    //
    // After the write and non-fatal, for the same reason as the create path.
    if (assignedOvertimeIds !== undefined) {
      const reassigned = Boolean(userId) && userId !== existing.userId;
      const alreadyMarked = new Set(reassigned ? [] : existing.overtimeCreatorIds ?? []);
      await queueOvertimeAssignedForShift({
        userId: userId ?? existing.userId,
        occurrenceMs: startMs ?? existing.startTime.toMillis(),
        addedCreatorIds: assignedOvertimeIds.filter(id => !alreadyMarked.has(id)),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[shifts PUT]', err);
    return NextResponse.json({ error: 'Failed to update shift' }, { status: 500 });
  }
});

// ─── DELETE /api/shifts/[shiftId] ────────────────────────────────────
// ?mode=single|future|series&overrideDate=ISO(required for single/future)

export const DELETE = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ shiftId: string }> | { shiftId: string },
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { shiftId } = await Promise.resolve(params);
    const { searchParams } = new URL(request.url);
    const mode           = searchParams.get('mode') ?? 'single';
    const overrideDateStr = searchParams.get('overrideDate');

    const shiftDoc = await adminDb.collection('shifts').doc(shiftId).get();
    if (!shiftDoc.exists) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }
    const existing = shiftDoc.data() as ShiftDocument;

    if (mode === 'series') {
      const rootId = existing.seriesId ?? shiftId;
      await deleteShiftSeries(rootId);
    } else if (mode === 'future') {
      // Truncate series so no occurrences exist from overrideDate onward
      if (!overrideDateStr) {
        return NextResponse.json({ error: 'overrideDate required for future delete' }, { status: 400 });
      }
      const overrideDateMs = new Date(overrideDateStr).getTime();
      const rootId = existing.seriesId ?? shiftId;
      await truncateSeriesAt(rootId, overrideDateMs);
    } else {
      // mode === 'single'
      if (existing.isRecurring) {
        // Recurring: create a tombstone override for this specific occurrence
        if (!overrideDateStr) {
          return NextResponse.json({ error: 'overrideDate required for single occurrence delete' }, { status: 400 });
        }
        const overrideDateMs = new Date(overrideDateStr).getTime();
        const rootId = existing.seriesId ?? shiftId;
        await deleteOccurrence(
          rootId,
          overrideDateMs,
          existing.userId,
          token.uid,
          existing.userTimezone,
        );
      } else {
        // One-time or override doc — just delete the document
        await deleteShift(shiftId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[shifts DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete shift' }, { status: 500 });
  }
});
