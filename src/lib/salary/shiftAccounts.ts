/**
 * Which of a shift's accounts set its hourly rate.
 *
 * One function, because this rule is read on five surfaces — the engine, the
 * assignment field, both schedules and the salary breakdown — and a second copy
 * of it is a second answer to "what does this shift pay".
 *
 * ## The rule
 *
 * `overtimeCreatorIds` marks accounts worked **on top of** the agent's own
 * roster, so they are subtracted from the wage tier: 3 regular accounts plus 2
 * overtime still pays the 3-account rate (ca-salary.md §6).
 *
 * **Unless every account on the shift is one.** A shift whose whole assignment
 * is overtime is not a shift being worked for free — it is an overtime shift,
 * the second-shift-in-a-day case, and its accounts are exactly what it pays on.
 * Subtracting them all would hand an agent a $0/hour shift for marking their
 * overtime shift as overtime, which is the honest thing to do and must not be
 * the thing that costs them.
 *
 * So the marking means two different things depending on what it is beside:
 *
 * | Shift | Marked | Pays on |
 * |---|---|---|
 * | 3 regular + 2 overtime | a subset | the 3 regular |
 * | 2 overtime, nothing else | all of them | all 2 — and `isFullyOvertime` is true |
 *
 * In the second case the marking survives as **display only**, which is what it
 * is for there: the agent opens their calendar and sees at a glance that this
 * one is overtime.
 */

export interface ShiftAccountSplit {
  /** The accounts the hourly rate is counted from. Distinct. Empty only when nothing is assigned. */
  paidIds: string[];
  /** Accounts marked overtime, for the ring and the count. Distinct. Not necessarily unpaid — see above. */
  overtimeIds: string[];
  /** True when the assignment is non-empty and every account in it is marked overtime. */
  isFullyOvertime: boolean;
}

export function splitShiftAccounts(
  creatorIds: readonly string[] | undefined,
  overtimeCreatorIds: readonly string[] | undefined,
): ShiftAccountSplit {
  // Deduplicated here, once, rather than at each reader. The engine counts
  // through a `Set` and the UI counts with `.length`; on a document that
  // somehow held a repeated id those two would report different account counts
  // for the same shift, and the screen disagreeing with the payslip is the
  // failure this subsystem is least able to afford. `normaliseAccountIds`
  // already dedupes on write — this makes a reader that meets older or
  // hand-edited data agree with it anyway.
  const assigned = [...new Set(creatorIds ?? [])];
  const marked = new Set(overtimeCreatorIds ?? []);

  const overtimeIds = assigned.filter(id => marked.has(id));
  const regularIds = assigned.filter(id => !marked.has(id));

  // Every account marked, and there is at least one: an overtime shift. It pays
  // on its own accounts, the same as one created from the coverage board.
  const isFullyOvertime = assigned.length > 0 && regularIds.length === 0;

  return {
    paidIds: isFullyOvertime ? [...assigned] : regularIds,
    overtimeIds,
    isFullyOvertime,
  };
}
