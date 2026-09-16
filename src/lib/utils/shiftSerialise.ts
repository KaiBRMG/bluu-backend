import type { ShiftDocument } from '@/types/firestore';

/**
 * Firestore ShiftDocument → the ISO-string shape `expandShiftsForWindow`
 * (src/lib/utils/recurrence.ts) expects. Recurrence expansion works entirely in
 * ISO strings, so Timestamps must be serialised before it can be called.
 */

/**
 * Any of the date shapes the `shifts` collection actually contains → an ISO
 * string.
 *
 * It has to accept more than `Timestamp` because the collection genuinely holds
 * more than one shape. `recurrence.endDate` in particular has two writers that
 * never agreed: `createShift`/`updateShift` stored whatever the client sent
 * (the shift modal sends an ISO **string**), while `truncateSeriesAt` writes a
 * real `Timestamp`. A reader that assumed `Timestamp` threw
 * `r.endDate.toDate is not a function` and took the whole week view down with a
 * 500 — for one field, on one document.
 *
 * The write side now coerces (see `toRecurrenceTimestamp` in `shiftService.ts`),
 * but documents written before that fix are still out there, so this stays
 * permanently: one bad field must degrade to "no value", never to an outage.
 */
function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  // Firestore Timestamp — the shape everything is supposed to be.
  if (typeof value === 'object' && value !== null && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();

  // Epoch millis, or a `{seconds, nanoseconds}` Timestamp that lost its
  // prototype crossing a serialisation boundary.
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : null;
  if (typeof value === 'object' && typeof (value as { seconds?: unknown }).seconds === 'number') {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }

  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  return null;
}

export function serialiseRecurrence(r: ShiftDocument['recurrence']) {
  if (!r) return null;
  return {
    ...r,
    // A null here means "no end date", i.e. the series runs on. That is the
    // safe way to fail: a series that visibly never ends gets noticed and
    // corrected, whereas throwing here blanks the roster for everyone.
    endDate: toIsoString(r.endDate),
  };
}

export function serialiseShift(s: ShiftDocument) {
  return {
    shiftId:        s.shiftId,
    userId:         s.userId,
    startTime:      toIsoString(s.startTime) ?? new Date(0).toISOString(),
    endTime:        toIsoString(s.endTime) ?? new Date(0).toISOString(),
    wallClockStart: s.wallClockStart,
    wallClockEnd:   s.wallClockEnd,
    userTimezone:   s.userTimezone,
    isRecurring:    s.isRecurring,
    recurrence:     serialiseRecurrence(s.recurrence),
    seriesId:       s.seriesId,
    overrideDate:   toIsoString(s.overrideDate),
    isDeleted:      s.isDeleted,
    // Creator assignment. Defaulted rather than passed through as undefined so
    // every consumer can read `.creatorIds.length` without a guard — shifts
    // created before assignment existed simply report none, which is exactly
    // what the salary engine's inferred-account fallback keys off.
    creatorIds:     s.creatorIds ?? [],
    // Defended the same way and for the same reason: every consumer reads
    // `.length` on it, and the subset is what the wage tier is counted *against*
    // — a missing field must mean "none are overtime", never `undefined`.
    overtimeCreatorIds: s.overtimeCreatorIds ?? [],
    isOvertime:     s.isOvertime ?? false,
    coverageOfferId: s.coverageOfferId ?? null,
    paysWage:       s.paysWage ?? true,
  };
}
