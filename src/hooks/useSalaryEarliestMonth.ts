'use client';

import { useUserData } from '@/hooks/useUserData';
import { currentMonthKey, toMonthKey } from '@/lib/salary/salaryDate';

/**
 * The oldest month a salary surface should let someone walk back to.
 *
 * `MonthPicker` exists to stop the back arrow at the first month with data — its
 * own doc comment says so — but neither CA dashboard route was passing
 * `earliest`, so the `-24` default left roughly two years of months that predate
 * the subsystem reachable. They render as empty tables, which reads as data loss
 * rather than as "nothing happened here".
 *
 * There is no endpoint for "your first month with sales", and inventing a launch
 * date would be a constant nobody maintains. The floor used instead is a fact the
 * client already holds: **an agent cannot have earned before their account
 * existed.** `createdAt` is a Firestore `Timestamp` on the live snapshot, but this
 * runs against cached and serialised shapes too, so every plausible form is
 * handled and an unreadable one falls through to the picker's own default.
 */
export function useSalaryEarliestMonth(): string | undefined {
  const { userData } = useUserData();
  const createdAt = userData?.createdAt as unknown;

  const ms = toMillis(createdAt);
  if (ms === null) return undefined;

  // Never return a floor ahead of the current month: that would disable both
  // arrows and strand the viewer on a month they cannot leave.
  const month = toMonthKey(ms);
  return month > currentMonthKey() ? undefined : month;
}

function toMillis(value: unknown): number | null {
  if (value == null) return null;

  if (typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }

  // `{ seconds, nanoseconds }` — a Timestamp that has been through JSON.
  if (typeof value === 'object' && 'seconds' in value) {
    const seconds = (value as { seconds: unknown }).seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }

  if (typeof value === 'number') return value;

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return null;
}
