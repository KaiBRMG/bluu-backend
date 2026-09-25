'use client';

import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLeaveHistory, type LeaveHistoryEvent, type LeaveHistoryRow } from '@/hooks/useLeaveHistory';
import { STATUS_COLORS } from '@/lib/campaignTracking';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { formatDayLabelWithWeekday, toDayKey } from '@/lib/salary/salaryDate';
import { formatRelative } from '@/lib/salary/salaryFormat';

/**
 * Coverage → History: every leave request that reached an outcome, and what it
 * did to the agent's balance.
 *
 * The resolved half of the decision queue (DESIGN.md §5): same row, the action
 * lane swapped for the outcome pill. Hues are borrowed from `STATUS_COLORS` —
 * approved is an outcome in green, denied in red, withdrawn is neutral.
 *
 * ## The balance trail is the point
 *
 * Each row states the balance either side of every step the request took —
 * `4 → 3` when it was requested, `3 → 4` when it was denied — read from
 * `leave-ledger` (see `leaveLedger.ts`). Two kinds of gap are stated rather than
 * hidden:
 *
 * - a request decided before the ledger existed has no trail, and says so;
 * - the reset on finalising a month and a hand edit in CA Admin → Leave move balances
 *   without a request, so they never appear here. The footnote says that once,
 *   so nobody reads the trail as the whole story of a balance.
 */

type Outcome = LeaveHistoryRow['outcome'];

const OUTCOME_LABEL: Record<Outcome, string> = {
  approved: 'Approved',
  denied: 'Denied',
  withdrawn: 'Withdrawn',
};

const OUTCOME_PILL: Record<Outcome, string> = {
  approved: STATUS_COLORS.Completed,
  denied: STATUS_COLORS.Rejected,
  withdrawn: STATUS_COLORS.Archived,
};

const ACTION_LABEL: Record<LeaveHistoryEvent['action'], string> = {
  requested: 'requested',
  approved: 'approved',
  denied: 'denied',
  withdrawn: 'withdrawn',
};

const ALL = '__all__';

export function LeaveHistory() {
  const { rows, loading, error, refetch } = useLeaveHistory();
  const [agent, setAgent] = useState<string>(ALL);
  const [outcome, setOutcome] = useState<string>(ALL);

  const agents = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of rows) byId.set(row.userId, row.displayName ?? row.userId);
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const visible = rows.filter(
    row => (agent === ALL || row.userId === agent) && (outcome === ALL || row.outcome === outcome),
  );
  const filtered = agent !== ALL || outcome !== ALL;

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-80 rounded-md" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-400">
        {error}{' '}
        <Button size="xs" variant="ghost" onClick={() => void refetch()} className="text-red-400 hover:text-red-300">
          Try again
        </Button>
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400">No leave has been decided yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={agent} onValueChange={setAgent}>
          <SelectTrigger size="sm" className="w-48" aria-label="Filter by agent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All agents</SelectItem>
            {agents.map(([uid, name]) => (
              <SelectItem key={uid} value={uid}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger size="sm" className="w-40" aria-label="Filter by outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All outcomes</SelectItem>
            {(Object.keys(OUTCOME_LABEL) as Outcome[]).map(key => (
              <SelectItem key={key} value={key}>
                {OUTCOME_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs tabular-nums text-zinc-400">
          {filtered ? `${visible.length} of ${rows.length}` : `${rows.length} requests`}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Nothing matches these filters.{' '}
          <button
            type="button"
            onClick={() => {
              setAgent(ALL);
              setOutcome(ALL);
            }}
            className="rounded-sm text-zinc-300 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Clear them to see all {rows.length}
          </button>
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.07] rounded-lg border border-white/[0.07]">
          {visible.map(row => (
            <HistoryRow key={row.leaveId} row={row} />
          ))}
        </ul>
      )}

      <p className="max-w-[70ch] text-xs leading-relaxed text-zinc-400">
        Balances shown are only the changes leave requests made. Finalising a salary month also resets leave, and
        edits made in CA Admin → Leave change balances too. Neither is listed here.
      </p>
    </div>
  );
}

function HistoryRow({ row }: { row: LeaveHistoryRow }) {
  const name = row.displayName ?? 'Unknown user';

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
      <div className="flex min-w-0 flex-1 gap-2.5">
        <Avatar className="size-7 shrink-0">
          <AvatarImage src={row.photoURL ?? undefined} alt="" />
          <AvatarFallback style={{ backgroundColor: getAvatarColor(row.displayName || 'User') }}>
            {getInitials(row.displayName || 'User')}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <p className="text-sm">
            <span className="font-medium">{name}</span>
            <span className="text-zinc-400"> · {row.leaveType} leave</span>
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {formatDayLabelWithWeekday(toDayKey(row.occurrenceStart))}
            <span aria-hidden> · </span>
            {describeOutcome(row)}
          </p>
          {row.reason && <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-zinc-400">{row.reason}</p>}
          <BalanceTrail row={row} />
        </div>
      </div>

      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', OUTCOME_PILL[row.outcome])}>
        {OUTCOME_LABEL[row.outcome]}
      </span>
    </li>
  );
}

function describeOutcome(row: LeaveHistoryRow): string {
  const when = row.decidedAt ? formatRelative(row.decidedAt) : 'at an unknown time';
  if (row.outcome === 'withdrawn') {
    const from = row.withdrawnFrom && row.withdrawnFrom !== 'pending' ? ` after it was ${row.withdrawnFrom}` : ' before a decision';
    return `withdrawn ${when}${from}`;
  }
  return `${row.outcome} ${when}${row.decidedByName ? ` by ${row.decidedByName}` : ''}`;
}

/**
 * The balance either side of each step, e.g. `Unpaid balance 4 → 3 requested ·
 * 3 → 4 denied`. A step that moved nothing says so rather than printing `3 → 3`,
 * which reads as a typo.
 */
function BalanceTrail({ row }: { row: LeaveHistoryRow }) {
  const label = row.leaveType === 'paid' ? 'Paid balance' : 'Unpaid balance';

  if (row.events.length === 0) {
    return (
      <p className="mt-1.5 text-[11px] text-zinc-400">
        {label}: not recorded. This was decided before balance changes were logged.
      </p>
    );
  }

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-zinc-400">
      <span>{label}</span>
      {row.events.map((event, index) => (
        <span key={`${event.action}:${index}`} className="inline-flex items-center gap-1">
          {index > 0 && <span aria-hidden>·</span>}
          {event.before === event.after ? (
            <span>
              <span className="tabular-nums text-zinc-300">{event.after}</span> {ACTION_LABEL[event.action]}, no change
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="tabular-nums text-zinc-300">{event.before}</span>
              <ArrowRight className="size-3" aria-hidden />
              <span className="sr-only">to</span>
              <span className="tabular-nums text-zinc-300">{event.after}</span>
              <span>{ACTION_LABEL[event.action]}</span>
            </span>
          )}
        </span>
      ))}
    </p>
  );
}
