/**
 * Splitting a recurring series in two — the parts every split must get right, pure.
 *
 * A series is split by truncating its root before some date and starting a new
 * root on that date. Two callers do it: "edit this and future" in Shift
 * Management (`PUT /api/shifts/[shiftId]`, `saveMode: 'future'`) and archiving
 * a creator (`archiveShiftPlan.ts`). Truncate-and-create alone is not a split;
 * three more things are, and leaving any out was a real bug:
 *
 * - **`count` carries over.** A "10 occurrences" rule is a total for the series.
 *   The new root has to run only what is left, or it starts counting again from
 *   ten.
 * - **Override and tombstone docs dated on or after the split move to the new
 *   root.** Expansion matches them to a root by `seriesId`. Left on the old
 *   root, an edited occurrence shows *beside* the new root's copy of that date,
 *   and a tombstone (a deleted day, or one released for leave) stops hiding
 *   anything. The agent then appears back on the roster on a day their accounts
 *   are on the overtime board.
 * - **Approved leave that released one of those dates follows the tombstone.**
 *   Withdrawing leave looks for its tombstone under `releasedShiftId`. Pointed
 *   at the old root, it never finds it and the shift never comes back.
 *
 * An override's *id* never changes, so leave that released an override (it
 * soft-deletes that document and records its id) needs nothing.
 *
 * **When the split also hands the series to another agent** (edit this and
 * future, A → B), the outgoing agent's own documents stay with A's series:
 * `outgoingAgent` excludes them. Moved, A's leave tombstone would hide a day
 * of B's that nobody released, and A's edited day would replace B's. A
 * document for a *third* agent (one day of A's given to C) still moves, so C
 * keeps that day instead of sharing it with B. Leave moves exactly when its
 * tombstone does: both carry the absent agent's `userId`.
 */

export interface SplitLeave {
  leaveId: string;
  userId?: string;
  status: 'pending' | 'approved' | 'denied';
  shiftId: string;
  occurrenceStart: number;
  releasedShiftId: string | null;
  releasedOccurrenceStart: number | null;
}

/**
 * What a new root's `count` must be: the rule's total less the occurrences the
 * old root already emitted. `null` is an unlimited rule; zero or less means the
 * series has nothing left to run.
 */
export function remainingCount(count: number | null | undefined, before: number): number | null {
  return count == null ? null : count - before;
}

/** The overrides and tombstones of `rootId` that a split at `overrideDateMs` hands to the new root. */
export function docsMovedBySplit<T extends { seriesId: string | null; overrideDateMs: number | null; userId?: string }>(
  docs: readonly T[],
  rootId: string,
  overrideDateMs: number,
  outgoingAgent?: string,
): T[] {
  return docs.filter(
    d =>
      d.seriesId === rootId &&
      d.overrideDateMs !== null &&
      d.overrideDateMs >= overrideDateMs &&
      (outgoingAgent === undefined || d.userId !== outgoingAgent),
  );
}

/**
 * Approved leave that released an occurrence of `rootId` starting at or after
 * `occurrenceStartMs`. Each has its `releasedShiftId` moved to the new root.
 * Leave approved before `releasedShiftId` was recorded falls back to its pin,
 * as `revertOccurrenceCoverage` does.
 */
export function leavesMovedBySplit(
  leaves: readonly SplitLeave[],
  rootId: string,
  occurrenceStartMs: number,
  outgoingAgent?: string,
): Array<{ leaveId: string; releasedOccurrenceStart: number }> {
  return leaves
    .filter(l => l.status === 'approved' && (outgoingAgent === undefined || l.userId !== outgoingAgent))
    .map(l => ({
      leaveId: l.leaveId,
      shiftId: l.releasedShiftId ?? l.shiftId,
      start: l.releasedOccurrenceStart ?? l.occurrenceStart,
    }))
    .filter(l => l.shiftId === rootId && l.start >= occurrenceStartMs)
    .map(l => ({ leaveId: l.leaveId, releasedOccurrenceStart: l.start }));
}
