import type { ChatterPeriod } from '@/lib/buddyx/analyticsTypes';

/**
 * The period control shared by Chatter Analytics and its per-chatter report.
 * `7d` is the last seven COMPLETE days (today is still syncing) and the default.
 */
export const CHATTER_PERIOD_OPTIONS: Array<{ value: ChatterPeriod; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: 'mtd', label: 'MTD' },
  { value: 'prev-month', label: 'Last month' },
  { value: '30d', label: '30d' },
  { value: 'custom', label: 'Custom' },
];

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
