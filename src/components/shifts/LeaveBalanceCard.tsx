'use client';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserData } from '@/hooks/useUserData';
import { useLeaveRequests } from '@/hooks/useLeaveRequests';
import { pluralise } from '@/lib/salary/salaryFormat';

/**
 * How much time off the agent has left.
 *
 * Deliberately small, and deliberately **not a link** — there is nowhere left
 * to send anyone. Requesting leave happens on the calendar directly below, and
 * the status of every request shows on the shift it belongs to.
 *
 * It briefly linked to `/ca-portal/shifts`, which bounced anyone without that
 * page's separate permission back to the home page (`AppLayout` redirects an
 * inaccessible route). That page has since been deleted as redundant, but the
 * rule it taught stands: **a dashboard card must not link to a page the viewer
 * may not hold.**
 *
 * **Paid leave is shown only when the agent has it.** `remainingPaidLeave`
 * defaults to 10 whether or not `hasPaidLeave` is set, so rendering it
 * unconditionally tells someone with no paid entitlement that they have ten
 * days of it — the same bug that reached a user in the request dialog. Gate on
 * `hasPaidLeave`, never on the number.
 */

export function LeaveBalanceCard({ className }: { className?: string }) {
  const { userData, loading } = useUserData();
  const { leaveRequests } = useLeaveRequests();

  // A balance of zero and a balance not yet known are not the same fact. Without
  // this the card asserted "0 unpaid days left" as truth for the whole fetch —
  // wrong status rather than missing status, about someone's time off.
  if (loading && !userData) {
    return (
      <section
        className={cn(
          'flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3',
          className,
        )}
      >
        <Skeleton className="h-5 w-16 rounded" />
        <Skeleton className="h-5 w-32 rounded" />
      </section>
    );
  }

  const hasPaidLeave = userData?.hasPaidLeave === true;
  const unpaidRemaining = userData?.remainingUnpaidLeave ?? 0;
  const paidRemaining = userData?.remainingPaidLeave ?? 0;

  const pending = leaveRequests.filter(r => r.status === 'pending').length;

  return (
    <section
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h2 className="text-sm font-semibold">Time off</h2>

        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
          <div className="flex items-baseline gap-1.5">
            <dd className="text-lg font-semibold tabular-nums">
              {unpaidRemaining}
            </dd>
            <dt className="text-xs text-zinc-400">unpaid {unpaidRemaining === 1 ? 'day' : 'days'} left</dt>
          </div>

          {hasPaidLeave && (
            <div className="flex items-baseline gap-1.5">
              <dd className="text-lg font-semibold tabular-nums">
                {paidRemaining}
              </dd>
              <dt className="text-xs text-zinc-400">paid {paidRemaining === 1 ? 'day' : 'days'} left</dt>
            </div>
          )}
        </dl>
      </div>

      {pending > 0 && (
        <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-400">
          {pluralise(pending, 'request')} awaiting approval
        </span>
      )}
    </section>
  );
}
