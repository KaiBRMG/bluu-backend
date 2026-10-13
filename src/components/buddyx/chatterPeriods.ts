import type { ChatterPeriod } from '@/lib/buddyx/analyticsTypes';
import { monthName } from './PeriodPicker';

/**
 * The presets shared by Chatter Analytics and its per-chatter report; a custom
 * range comes from the start/end inputs beside them (`PeriodPicker`). `7d` is
 * the last seven COMPLETE days (today is still syncing) and the default.
 */
export function chatterPeriodOptions(now = new Date()): Array<{ value: Exclude<ChatterPeriod, 'custom' | '30d'>; label: string }> {
  return [
    { value: '7d', label: 'Last 7 days' },
    { value: 'mtd', label: monthName(0, now) },
    { value: 'prev-month', label: monthName(1, now) },
    { value: 'month-2', label: monthName(2, now) },
    { value: '3m', label: 'Last 3 months' },
    { value: '6m', label: 'Last 6 months' },
    { value: '12m', label: 'Last year' },
  ];
}

/** `base?period=…[&from&to]`, or null for a custom range that is not complete yet. */
export function chatterAnalyticsUrl(base: string, period: ChatterPeriod, from: string | null, to: string | null): string | null {
  if (period !== 'custom') return `${base}?period=${period}`;
  if (!from || !to || to < from) return null;
  return `${base}?period=custom&from=${from}&to=${to}`;
}

/** The report page for one agent, carrying the period it was opened from. */
export function chatterReportHref(uid: string, period: ChatterPeriod, from: string | null, to: string | null): string {
  return chatterAnalyticsUrl(`/ca-portal/chatter-analytics/${encodeURIComponent(uid)}`, period, from, to)
    ?? `/ca-portal/chatter-analytics/${encodeURIComponent(uid)}?period=7d`;
}
