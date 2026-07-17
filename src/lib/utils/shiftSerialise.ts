import type { ShiftDocument } from '@/types/firestore';

/**
 * Firestore ShiftDocument → the ISO-string shape `expandShiftsForWindow`
 * (src/lib/utils/recurrence.ts) expects. Recurrence expansion works entirely in
 * ISO strings, so Timestamps must be serialised before it can be called.
 */

export function serialiseRecurrence(r: ShiftDocument['recurrence']) {
  if (!r) return null;
  return {
    ...r,
    endDate: r.endDate ? r.endDate.toDate().toISOString() : null,
  };
}

export function serialiseShift(s: ShiftDocument) {
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
