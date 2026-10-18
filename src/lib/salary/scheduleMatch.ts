/**
 * Who the shift schedule says was working a creator account at the moment of a
 * sale — the "off schedule" anomaly on CA Admin → Sales.
 *
 * BuddyX credits a tip to whoever was on shift *in BuddyX*, and a PPV to its
 * sender; the shift schedule (`shifts.creatorIds`) is Bluu's own record of who
 * was meant to be on the account. When a sale is held by someone the schedule
 * does not put on that account, an admin wants to see it — it is the commonest
 * reason a sale lands on the wrong agent.
 *
 * Pure: the caller fetches and expands the shifts (`expandShiftsForWindow`), so
 * recurrence, per-occurrence overrides and leave tombstones are already
 * resolved. Creator ids and sub-account ids share `shifts.creatorIds` (rule
 * 9h), and a sale's `creatorId` is whichever of the two its handle mapped to,
 * so they compare directly.
 *
 * Display only — nothing on the pay path reads this.
 */

/** How far either side of a scheduled shift the holder still counts as on it — handovers, a sale typed a minute late. */
export const SCHEDULE_GRACE_MS = 15 * 60_000;

export interface ScheduleOccurrence {
  userId: string;
  creatorIds?: string[];
  occurrenceStart: number;
  occurrenceEnd: number;
}

export interface ScheduleSale {
  saleId: string;
  userId: string | null;
  creatorId: string | null;
  occurredAt: string;
  removedAt: string | null;
}

export interface ScheduleMatch {
  /** Agents the schedule puts on this sale's account at its instant, by uid, sorted. Empty = nobody scheduled. */
  scheduled: string[];
  /** Held by someone other than a scheduled agent (or by nobody) while someone was scheduled. */
  offSchedule: boolean;
}

/**
 * One entry per live sale that has a creator **and** a scheduled agent — a sale
 * on an account nobody was scheduled on has nothing to compare against, and is
 * left out rather than flagged.
 */
export function matchSalesToSchedule(
  sales: ScheduleSale[],
  occurrences: ScheduleOccurrence[],
  graceMs: number = SCHEDULE_GRACE_MS,
): Map<string, ScheduleMatch> {
  const byCreator = new Map<string, Array<{ userId: string; start: number; end: number }>>();
  for (const o of occurrences) {
    for (const creatorId of o.creatorIds ?? []) {
      const list = byCreator.get(creatorId) ?? [];
      list.push({ userId: o.userId, start: o.occurrenceStart, end: o.occurrenceEnd });
      byCreator.set(creatorId, list);
    }
  }

  const out = new Map<string, ScheduleMatch>();
  for (const sale of sales) {
    if (sale.removedAt || !sale.creatorId) continue;
    const slots = byCreator.get(sale.creatorId);
    if (!slots) continue;
    const at = Date.parse(sale.occurredAt);
    if (Number.isNaN(at)) continue;

    const scheduled = new Set<string>();
    let holderNear = false;
    for (const slot of slots) {
      if (slot.start <= at && at < slot.end) scheduled.add(slot.userId);
      if (sale.userId && slot.userId === sale.userId && slot.start - graceMs <= at && at < slot.end + graceMs) {
        holderNear = true;
      }
    }
    if (scheduled.size === 0) continue;
    out.set(sale.saleId, { scheduled: [...scheduled].sort(), offSchedule: !holderNear });
  }
  return out;
}
