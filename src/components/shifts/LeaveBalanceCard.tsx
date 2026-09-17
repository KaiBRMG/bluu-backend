'use client';

import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBootPhase } from '@/contexts/BootLoaderContext';
import { useUserData } from '@/hooks/useUserData';
import { useLeaveRequests, type LeaveRequest } from '@/hooks/useLeaveRequests';
import { resolveLeaveBalances } from '@/lib/leave/leaveBalance';
import { formatDayLabelWithWeekday, toDayKey } from '@/lib/salary/salaryDate';
import { pluralise } from '@/lib/salary/salaryFormat';

/**
 * How much time off the agent has left, and what happened to what they asked for.
 *
 * Deliberately small, and deliberately **not a link** — there is nowhere to send
 * anyone. Requesting leave happens on the calendar directly below.
 *
 * It briefly linked to `/ca-portal/shifts`, which bounced anyone without that
 * page's separate permission back to the home page. That page has since been
 * deleted, but the rule it taught stands: **a dashboard card must not link to a
 * page the viewer may not hold.**
 *
 * ## This card is the only place a decision lands
 *
 * There is **no notification when leave is approved or denied** (ca-salary.md
 * §11) — the approver hears about the request, the agent never hears the answer.
 * The only other rendering of an outcome is the badge on that shift's calendar
 * cell, which may be three weeks out and invisible in the default week view. So
 * an agent could be denied a day and find out by not being on the roster.
 *
 * `DecisionPills` is that missing channel: every request decided in the last
 * {@link DECISION_WINDOW_DAYS} days shows here, coloured by outcome and naming
 * the date, until the agent dismisses it. Dismissal is per-browser
 * (`localStorage`) rather than a Firestore write — this is an acknowledgement,
 * not a fact anyone else needs, and a write per dismissal would be a document
 * update to say "I saw that".
 *
 * ## Balances come from the engine, never from the raw field
 *
 * `resolveLeaveBalances` is the only reader of `remainingPaidLeave` /
 * `remainingUnpaidLeave` on this surface. It applies the defaults once and gates
 * the paid figure on `hasPaidLeave`, because `remainingPaidLeave` defaults to 10
 * whether or not the entitlement is set — rendering it unconditionally tells
 * someone with no paid leave that they have ten days of it.
 */

/** How long a decided request keeps announcing itself on the dashboard. */
const DECISION_WINDOW_DAYS = 14;

const DISMISSED_KEY = 'bluu_leave_decisions_seen_v1';

/**
 * Which decisions this browser has already acknowledged.
 *
 * Every access is wrapped: `localStorage` throws outright in a private window
 * and with site data blocked, and a dismissal list is never worth taking the
 * card down for. Failing to an empty list means the agent sees a pill again —
 * the safe direction, since the alternative is silently hiding the only place a
 * denial is ever shown.
 */
function readDismissed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function LeaveBalanceCard({ className }: { className?: string }) {
  const { userData, loading } = useUserData();
  const { leaveRequests, loading: leaveLoading, error: leaveError, refetch } = useLeaveRequests();

  // Gated like every other async block on this dashboard, so the boot loader
  // lifts on a complete page rather than on one finished card over two skeletons.
  useBootPhase('ca-leave-balance', loading && !userData);

  // A balance of zero and a balance not yet known are not the same fact. Without
  // this the card asserted "0 unpaid days left" as truth for the whole fetch —
  // wrong status rather than missing status, about someone's time off.
  if (loading && !userData) {
    return (
      <section
        className={cn(
          'flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl px-4 py-3',
          SURFACE,
          className,
        )}
      >
        <Skeleton className="h-5 w-16 rounded" />
        <Skeleton className="h-5 w-32 rounded" />
      </section>
    );
  }

  const { unpaid, paid, hasPaidLeave } = resolveLeaveBalances(userData);
  const pending = leaveRequests.filter(r => r.status === 'pending').length;

  return (
    <section
      className={cn('rounded-xl px-4 py-3', SURFACE, className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h2 className="text-sm font-semibold">Time off</h2>

          <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
            {/* `flex-row-reverse`, not a reordered DOM: the number reads first, but
                a definition list pairs each `dt` with the `dd` that follows it, and
                these were emitted the other way round. */}
            <div className="flex flex-row-reverse items-baseline gap-1.5">
              <dt className="text-xs text-zinc-400">unpaid {unpaid === 1 ? 'day' : 'days'} left</dt>
              <dd className="text-lg font-semibold tabular-nums">{unpaid}</dd>
            </div>

            {hasPaidLeave && (
              <div className="flex flex-row-reverse items-baseline gap-1.5">
                <dt className="text-xs text-zinc-400">paid {paid === 1 ? 'day' : 'days'} left</dt>
                <dd className="text-lg font-semibold tabular-nums">{paid}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* An unreadable request list is not an empty one. Without this branch a
            failed fetch renders no pending count and no decisions — the same
            silence as "nothing to report" — on the card that is the only place a
            decision appears at all. */}
        {leaveError ? (
          <span className="flex items-center gap-1.5 text-xs text-red-400">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden />
            Couldn&rsquo;t load your requests
            <Button
              size="xs"
              variant="ghost"
              className="ml-0.5 text-red-400 hover:text-red-300"
              onClick={() => void refetch()}
            >
              <RotateCcw className="size-3" aria-hidden />
              Retry
            </Button>
          </span>
        ) : (
          pending > 0 && (
            <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-400">
              {pluralise(pending, 'request')} awaiting approval
            </span>
          )
        )}
      </div>

      {!leaveError && !leaveLoading && <DecisionPills leaveRequests={leaveRequests} />}
    </section>
  );
}

/**
 * Recently decided requests, until acknowledged.
 *
 * Rendered as a second row rather than beside the balance: an approval and a
 * denial are the two things on this card an agent has to *act* on, and giving
 * them the full width is what stops them reading as another status chip.
 */
function DecisionPills({ leaveRequests }: { leaveRequests: LeaveRequest[] }) {
  // Read once, lazily, rather than in an effect that then calls `setState` —
  // that shape renders the pills and immediately re-renders without the ones
  // already dismissed, which is a visible flash of something the agent has
  // already dealt with. The `window` guard is what keeps the initializer safe if
  // this ever renders on the server; today it cannot, because the parent is
  // still in its skeleton branch until `useUserData` resolves on the client.
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  // Not read during render — that would make the output depend on when React
  // happened to re-render, and the rule that forbids it is the same one
  // `ShiftCalendar` follows. It matters here for the same reason: this renderer
  // routinely stays open for weeks (rule 9c), so a clock captured once at mount
  // would keep a fortnight-old decision pinned to the dashboard forever.
  // Refreshed when the window comes back to the user, which is when they would
  // next look at it.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  const dismiss = useCallback((leaveId: string) => {
    setDismissed(prev => {
      const next = [...prev, leaveId];
      try {
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-50)));
      } catch {
        /* see above */
      }
      return next;
    });
  }, []);

  const cutoff = now - DECISION_WINDOW_DAYS * 86_400_000;
  const recent = leaveRequests.filter(r => {
    if (r.status === 'pending' || dismissed.includes(r.leaveId)) return false;
    const resolved = r.resolvedAt ? Date.parse(r.resolvedAt) : NaN;
    return Number.isFinite(resolved) && resolved >= cutoff;
  });

  if (recent.length === 0) return null;

  return (
    <ul className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/[0.07] pt-2.5">
      {recent.map(leave => {
        const approved = leave.status === 'approved';
        const day = formatDayLabelWithWeekday(toDayKey(leave.occurrenceStart));
        return (
          <li
            key={leave.leaveId}
            className={cn(
              'flex items-center gap-1.5 rounded-full py-0.5 pl-2.5 pr-1 text-[11px] font-medium',
              approved ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400',
            )}
          >
            {/* The word carries the outcome, not the hue. Same rule as the
                calendar's leave badge: green and red at 11px on a dimmed screen
                is not a distinction someone should have to make about whether
                they are working on Tuesday. */}
            <span>
              Time off on {day} — {approved ? 'approved' : 'denied'}
            </span>
            <button
              type="button"
              onClick={() => dismiss(leave.leaveId)}
              aria-label={`Dismiss ${approved ? 'approved' : 'denied'} time off for ${day}`}
              className={cn(
                'relative rounded-full p-1 transition-colors duration-[120ms]',
                'hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                // The glyph is 10px; the hit area is not. WCAG 2.5.8 wants 24px
                // and the pill has no room to grow, so the target is expanded
                // past the icon instead of the icon being inflated.
                'after:absolute after:-inset-1.5 after:content-[""]',
              )}
            >
              <X className="size-2.5" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
