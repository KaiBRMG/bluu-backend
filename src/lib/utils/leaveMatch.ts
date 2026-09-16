/**
 * Matching a leave request back onto the shift occurrence it was made against.
 *
 * ## Why this is not just a key comparison
 *
 * A leave request pins a tuple at the moment it is submitted:
 *
 * ```
 *   leave_requests/{leaveId} → { shiftId, occurrenceStart, userId }
 * ```
 *
 * Every admin edit path in `/api/shifts/[shiftId]` **re-homes the occurrence
 * onto a different document id** while the request is still pending:
 *
 * | Edit                  | What the roster does                                      |
 * |-----------------------|-----------------------------------------------------------|
 * | `saveMode: 'single'`  | A new override doc holds the occurrence; the root does not |
 * | `saveMode: 'future'`  | The series is truncated and a **new root** is created      |
 * | delete + recreate     | A new document id entirely                                 |
 *
 * A strict `${shiftId}:${occurrenceStart}` lookup misses in all three cases, and
 * the visible result is a shift that renders with no leave badge while the
 * request is still sitting in the approvals queue — the roster and the queue
 * disagreeing about the same day.
 *
 * So the match degrades in tiers rather than failing: exact tuple, then the same
 * recurring series on the same day, then a lone occurrence on that day.
 *
 * ## Where it deliberately gives up
 *
 * Tier 3 requires the day to hold exactly **one** candidate occurrence for that
 * agent. An agent with a regular shift and an overtime shift on the same date
 * has two, and there is no honest way to tell which one the request was made
 * against once the tuple is gone. Badging the wrong one would offer an admin a
 * release of the wrong accounts, so an ambiguous day matches nothing and the
 * request stays visible where it always was — in the approvals queue.
 *
 * This is display-side resolution only. What approval actually *releases* is
 * resolved separately and server-side, against the live roster, by
 * `resolveLiveOccurrence` in `services/leaveCoverage.ts`.
 */

import { toDayKey } from '@/lib/salary/salaryDate';

/** The pinned half: what a leave request recorded when it was submitted. */
export interface LeaveOccurrenceRef {
  shiftId: string;
  occurrenceStart: number;
  userId: string;
}

/** The live half: an occurrence as the roster currently expands it. */
export interface OccurrenceRef {
  shiftId: string;
  seriesId: string | null;
  userId: string;
  occurrenceStart: number;
  isOvertime?: boolean;
}

/** The lookup key both call sites already use for an occurrence. */
export function occurrenceKey(o: { shiftId: string; occurrenceStart: number }): string {
  return `${o.shiftId}:${o.occurrenceStart}`;
}

/** The series a given occurrence belongs to — its root id, or its own id if it is one. */
function rootIdOf(o: OccurrenceRef): string {
  return o.seriesId ?? o.shiftId;
}

/**
 * Resolve leave requests onto live occurrences.
 *
 * Returns a map keyed by `occurrenceKey(occurrence)` so callers keep the lookup
 * shape they already had. Each occurrence takes at most one request, and each
 * request claims at most one occurrence — an exact tuple match always wins over
 * a degraded one, so re-homing a single occurrence can never steal the badge
 * from an untouched sibling.
 */
export function matchLeaveToOccurrences<L extends LeaveOccurrenceRef, O extends OccurrenceRef>(
  leaveRequests: L[],
  occurrences: O[],
): Map<string, L> {
  const matched = new Map<string, L>();
  if (leaveRequests.length === 0 || occurrences.length === 0) return matched;

  const byUser = new Map<string, O[]>();
  for (const o of occurrences) {
    const list = byUser.get(o.userId);
    if (list) list.push(o);
    else byUser.set(o.userId, [o]);
  }

  const claimed = new Set<string>();
  const unresolved: L[] = [];

  // ── Tier 1: the exact tuple ──
  // Run to completion before any degraded tier, so an occurrence that was never
  // touched keeps its own request.
  for (const leave of leaveRequests) {
    const candidates = byUser.get(leave.userId);
    if (!candidates) continue;
    const exact = candidates.find(
      o => o.shiftId === leave.shiftId && o.occurrenceStart === leave.occurrenceStart,
    );
    if (exact) {
      const key = occurrenceKey(exact);
      if (!claimed.has(key)) {
        claimed.add(key);
        matched.set(key, leave);
        continue;
      }
    }
    unresolved.push(leave);
  }

  if (unresolved.length === 0) return matched;

  // ── Tiers 2 and 3: the occurrence moved ──
  for (const leave of unresolved) {
    const candidates = (byUser.get(leave.userId) ?? []).filter(o => !claimed.has(occurrenceKey(o)));
    if (candidates.length === 0) continue;

    const leaveDay = toDayKey(leave.occurrenceStart);
    const sameDay = candidates.filter(o => toDayKey(o.occurrenceStart) === leaveDay);
    if (sameDay.length === 0) continue;

    // Tier 2 — same recurring series, same day. Covers `saveMode: 'single'`
    // (an override doc carrying `seriesId` back to the root the request named)
    // and a plain time change on a one-off shift.
    const sameSeries = sameDay.filter(
      o => rootIdOf(o) === leave.shiftId || o.shiftId === leave.shiftId,
    );

    // Tier 3 — the day holds exactly one shift for this agent, so there is
    // nothing to confuse it with. This is what recovers `saveMode: 'future'`,
    // where the new root shares no id with anything the request recorded.
    // Overtime is excluded first: cover someone else's absence is never the
    // shift an agent requested time off from.
    const ownShifts = sameDay.filter(o => o.isOvertime !== true);
    const pool = ownShifts.length > 0 ? ownShifts : sameDay;

    const hit =
      sameSeries.length === 1 ? sameSeries[0]
      : pool.length === 1 ? pool[0]
      : null;

    if (!hit) continue;

    const key = occurrenceKey(hit);
    claimed.add(key);
    matched.set(key, leave);
  }

  return matched;
}
