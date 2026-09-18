import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { claimNotificationLatch, getChatAgentUids, notifyUsers } from '@/lib/services/caNotifications';
import { flushCoverageNotices } from '@/lib/services/coverageNotices';
import { flushDisputeNotices } from '@/lib/services/disputeNotices';
import {
  addMonths,
  currentDayKey,
  currentMonthKey,
  dayKeyToStartMs,
  formatMonthLabel,
} from '@/lib/salary/salaryDate';

/**
 * GET /api/cron/ca-notifications — the chat-agent notification tick.
 *
 * Runs every 5 minutes (`vercel.json`) and does two unrelated jobs that share a
 * schedule because neither is worth a cron entry of its own:
 *
 * 1. **Flush coalesced coverage notices.** An admin assigning four released
 *    accounts to one agent must produce one message naming four creators, not
 *    four messages. `ca-coverage-notices` accumulates them and this sends each
 *    queue once it has been quiet for a few minutes — see
 *    `services/coverageNotices.ts` for why the delay cannot live inside the
 *    assignment request.
 * 2. **Flush coalesced dispute decisions.** A reviewer clearing a backlog
 *    decides many of one person's disputes in a sitting; that must produce one
 *    message naming the count, not one per dispute — see
 *    `services/disputeNotices.ts`.
 * 3. **The payday reminder**, 3 days before the 1st.
 *
 * It lives here rather than in `functions/` for the reason every scheduled job
 * that notifies does: notification copy lives only in `notificationContent.ts`
 * and Cloud Functions cannot import it (see the hub's system map).
 *
 * Every job is independent and each is caught on its own — a failure to flush
 * the coverage queue must not also skip the dispute queue or the payday
 * reminder for the month.
 */

/** Salary days are Africa/Harare, UTC+2, no DST (ca-salary.md §7). */
const PAYDAY_NOTICE_DAYS_BEFORE = 3;

/**
 * Hour of the salary day (00–23) at or after which the payday reminder may go
 * out. Without it the reminder lands at ~02:00 local for everyone, which is a
 * phone buzzing in the night for a message about checking a spreadsheet.
 */
const PAYDAY_NOTICE_HOUR = 9;

export async function GET() {
  // Read through `headers()` rather than off a `NextRequest`: `cacheComponents`
  // is on, and a route handler touching no request-scoped API prerenders — which
  // would serve every cron invocation a cached copy of the build-time 404 and
  // the tick would silently never run. Same reasoning as
  // /api/cron/onlyfans-media-usage.
  const authorization = (await headers()).get('authorization');

  // Fail **closed** when CRON_SECRET is unset: this endpoint writes
  // notifications to every chat agent, which is not something to leave open
  // because an env var was forgotten.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const report: Record<string, unknown> = {};

  try {
    report.coverage = await flushCoverageNotices();
  } catch (err) {
    console.error('[cron/ca-notifications] coverage flush failed', err);
    report.coverage = { error: 'failed' };
  }

  try {
    report.disputes = await flushDisputeNotices();
  } catch (err) {
    console.error('[cron/ca-notifications] dispute flush failed', err);
    report.disputes = { error: 'failed' };
  }

  try {
    report.payday = await maybeSendPaydayReminder();
  } catch (err) {
    console.error('[cron/ca-notifications] payday reminder failed', err);
    report.payday = { error: 'failed' };
  }

  try {
    return NextResponse.json(report);
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/ca-notifications');
  }
}

/**
 * Tell every chat agent to check their breakdown, 3 days before the 1st.
 *
 * "3 days before the 1st" is measured against the *next* month's first day in
 * the salary timezone, so it lands on the 29th of a 31-day month and the 26th of
 * a 29-day February without any month-length arithmetic of its own.
 *
 * The latch is what makes a 5-minute cron safe for a once-a-month message: it is
 * claimed with `create`, so the first tick past the hour sends and every later
 * tick that day sees the document and stops. Keyed by the month being paid, so
 * next month claims its own.
 */
async function maybeSendPaydayReminder(now: number = Date.now()) {
  const today = currentDayKey(now);
  const month = currentMonthKey(now);
  const nextMonthFirst = `${addMonths(month, 1)}-01`;

  const daysUntil = Math.round((dayKeyToStartMs(nextMonthFirst) - dayKeyToStartMs(today)) / 86_400_000);
  if (daysUntil !== PAYDAY_NOTICE_DAYS_BEFORE) return { sent: false, reason: `${daysUntil} days out` };

  const hourOfSalaryDay = Math.floor((now - dayKeyToStartMs(today)) / 3_600_000);
  if (hourOfSalaryDay < PAYDAY_NOTICE_HOUR) return { sent: false, reason: 'too early in the day' };

  if (!(await claimNotificationLatch(`payday-${month}`, { month }))) {
    return { sent: false, reason: 'already sent this month' };
  }

  const agents = await getChatAgentUids();
  const { delivered } = await notifyUsers(agents, notifications.paydayApproaching(formatMonthLabel(month)), {
    // One per agent per month, so a retry of a half-completed fan-out cannot
    // give anyone two.
    docIdFor: uid => `${uid}__payday-${month}`,
    label: 'paydayApproaching',
  });

  return { sent: true, month, recipients: delivered };
}
