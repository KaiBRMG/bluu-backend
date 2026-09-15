'use client';

import { useMemo, useState } from 'react';
import { Check, Clock, Loader2Icon, RotateCcw, TriangleAlert, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/components/AuthProvider';
import { useCoverageOffers, type CoverageOfferRow } from '@/hooks/useCoverageOffers';
import {
  useAdminLeaveQueue,
  type AdminLeaveRow,
  type LeaveDecisionResult,
} from '@/hooks/useAdminLeaveQueue';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatRelative, pluralise } from '@/lib/salary/salaryFormat';

/**
 * Coverage — the admin half of the absence pipeline.
 *
 * Two queues, because they are two decisions with different urgency:
 *
 * 1. **Leave requests.** Approving one tombstones the shift occurrence and posts
 *    its creator accounts to the overtime board automatically, where they appear
 *    on every chat agent's calendar. The row says so before you click, including
 *    how many accounts it will release — an approval that quietly uncovers four
 *    creators is not something to discover later.
 * 2. **Cover to assign.** Released accounts with agents' names against them.
 *    Assigning creates the overtime shift and pays it correctly.
 *
 * ## The in-shift / outside-shift distinction is shown, not asked
 *
 * The server works out whether an assignment sits inside the claimant's own
 * shift and prices it accordingly. This screen says which it will be, because it
 * is the difference between "they keep the sales" and "they keep the sales and
 * get paid for the hours" — and an admin approving cover should know which they
 * are authorising.
 */

export default function AdminCoverage() {
  const { offers, loading, error, refetch } = useCoverageOffers({});
  const { rows: pendingLeave, loading: leaveLoading, decide } = useAdminLeaveQueue('pending');

  const available = offers.filter(o => o.status === 'available');
  const assigned = offers.filter(o => o.status === 'assigned');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Coverage</h2>
        <p className="mt-0.5 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
          Approve time off, then assign the accounts it frees. Approving leave releases the agent&apos;s accounts to
          the overtime board automatically, where they show on every chat agent&apos;s calendar.
        </p>
      </div>

      <Tabs defaultValue="leave">
        <TabsList>
          <TabsTrigger value="leave">
            Leave requests
            {pendingLeave.length > 0 && (
              <span className="ml-1.5 rounded-full bg-orange-500/15 px-1.5 text-[11px] font-semibold tabular-nums text-orange-400">
                {pendingLeave.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="assign">
            To assign
            {available.length > 0 && (
              <span className="ml-1.5 rounded-full bg-[#3b82f6]/15 px-1.5 text-[11px] font-semibold tabular-nums text-[#3b82f6]">
                {available.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="assigned">Assigned</TabsTrigger>
        </TabsList>

        <TabsContent value="leave" className="mt-4">
          <LeaveQueue rows={pendingLeave} loading={leaveLoading} decide={decide} onResolved={refetch} />
        </TabsContent>

        <TabsContent value="assign" className="mt-4">
          {loading && <Skeleton className="h-48 w-full rounded-lg" />}
          {error && !loading && <p className="text-sm text-red-400">{error}</p>}
          {!loading && !error && available.length === 0 && (
            <p className="text-sm text-zinc-400">
              Nothing waiting to be covered. Accounts appear here when leave is approved.
            </p>
          )}
          {!loading && !error && available.length > 0 && (
            <ul className="divide-y divide-white/[0.07] rounded-lg border border-white/[0.07]">
              {available.map(offer => (
                <OfferRow key={offer.offerId} offer={offer} onChanged={refetch} />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="assigned" className="mt-4">
          {assigned.length === 0 ? (
            <p className="text-sm text-zinc-400">Nothing assigned yet.</p>
          ) : (
            <ul className="divide-y divide-white/[0.07] rounded-lg border border-white/[0.07]">
              {assigned.map(offer => (
                <OfferRow key={offer.offerId} offer={offer} onChanged={refetch} />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Leave queue ─────────────────────────────────────────────────────

function LeaveQueue({
  rows,
  loading,
  decide,
  onResolved,
}: {
  rows: AdminLeaveRow[];
  loading: boolean;
  decide: (leaveId: string, action: 'approve' | 'deny') => Promise<LeaveDecisionResult | null>;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  // Captured once per mount rather than read during render: an impure clock read
  // in a render body makes the output depend on when React happened to
  // re-render, and "in N days" does not need to be live to the millisecond.
  const [now] = useState(() => Date.now());

  async function resolve(row: AdminLeaveRow, action: 'approve' | 'deny') {
    setBusy(row.leaveId);
    try {
      const coverage = await decide(row.leaveId, action);

      if (action === 'deny') {
        toast.success('Leave denied \u2014 the agent has been notified');
      } else if (coverage?.noAssignments) {
        // Not an error, but the admin has to know: the shift went away and no
        // accounts were posted for cover, because none were ever assigned to it.
        toast.warning('Leave approved, but that shift had no accounts assigned \u2014 nothing was posted for cover.');
      } else if (coverage) {
        toast.success(
          `Leave approved \u2014 ${pluralise(coverage.offersCreated, 'account')} posted for cover (${coverage.creatorNames.join(', ')})`,
        );
      } else {
        toast.success('Leave approved');
      }

      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Skeleton className="h-40 w-full rounded-lg" />;

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400">Nothing outstanding.</p>;
  }

  return (
    <ul className="divide-y divide-white/[0.07] rounded-lg border border-white/[0.07]">
      {rows.map(row => {
        const daysAway = Math.round((row.occurrenceStart - now) / 86_400_000);

        return (
          <li key={row.leaveId} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
            <div className="flex min-w-0 flex-1 gap-2.5">
              <Avatar className="size-7 shrink-0">
                <AvatarImage src={row.photoURL ?? undefined} alt="" />
                <AvatarFallback style={{ backgroundColor: getAvatarColor(row.displayName ?? row.userId) }}>
                  {getInitials(row.displayName ?? row.userId)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{row.displayName ?? 'Unknown user'}</span>
                  <span className="text-zinc-400"> · {row.leaveType} leave</span>
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {formatDayLabelWithWeekday(new Date(row.occurrenceStart).toISOString().slice(0, 10))}
                  {daysAway >= 0 && ` · in ${pluralise(daysAway, 'day')}`}
                  {' · asked '}
                  {formatRelative(row.requestedAt)}
                </p>
                {/* The reason is the whole basis of the decision, so it renders in
                    full rather than truncated behind a hover (DESIGN.md §5). */}
                {row.reason && <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-zinc-400">{row.reason}</p>}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={busy === row.leaveId}
                onClick={() => void resolve(row, 'approve')}
                className="border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/15"
              >
                {busy === row.leaveId && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
                <Check className="size-3.5" aria-hidden />
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === row.leaveId}
                onClick={() => void resolve(row, 'deny')}
                className="text-red-400 hover:text-red-300"
              >
                Deny
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Offer row ───────────────────────────────────────────────────────

function OfferRow({ offer, onChanged }: { offer: CoverageOfferRow; onChanged: () => void }) {
  const { user } = useAuth();
  const { users } = useAdminUsers();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string>('');

  // Claimants first, then everyone else. The board is first-come, so the people
  // who put their names down should not have to be hunted for in an alphabetical
  // list of the whole team.
  const candidates = useMemo(() => {
    const claimants = new Set(offer.claims?.map(c => c.userId) ?? []);
    return users
      .filter(u => !u.isArchived && u.groups?.includes('CA') && u.uid !== offer.originalUserId)
      .map(u => ({ uid: u.uid, displayName: u.displayName ?? u.uid, claimed: claimants.has(u.uid) }))
      .sort((a, b) => Number(b.claimed) - Number(a.claimed) || a.displayName.localeCompare(b.displayName));
  }, [users, offer]);

  async function assign(userId: string) {
    if (!user) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/ca-coverage/assign', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: offer.offerId, userId }),
      });

      if (!res.ok) {
        let message = `Could not assign (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        toast.error(message);
        return;
      }

      const body = (await res.json()) as { inShift: boolean; merged: boolean };
      toast.success(
        body.inShift
          ? 'Assigned inside their existing shift — sales only, hours unchanged'
          : body.merged
            ? 'Added to their overtime shift — the hourly rate now reflects the extra account'
            : 'Overtime shift created — paid hours plus the sales',
      );
      setPicked('');
      onChanged();
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function release(cancel: boolean) {
    if (!user) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/ca-coverage/assign?offerId=${encodeURIComponent(offer.offerId)}${cancel ? '&cancel=true' : ''}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        toast.error('Could not update this offer');
        return;
      }
      toast.success(cancel ? 'Withdrawn from the board' : 'Put back on the board');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const isAssigned = offer.status === 'assigned';

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{offer.creatorName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-400">
          <Clock className="size-3" aria-hidden />
          {formatDayLabelWithWeekday(offer.day)}
          {offer.originalUserName && <>· released by {offer.originalUserName}</>}
        </p>

        {isAssigned ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-zinc-400">Covered by</span>
            <span className="font-medium">{offer.assignedToName ?? 'Unknown'}</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-px text-[10px] font-medium',
                offer.assignedInShift ? 'bg-zinc-500/15 text-zinc-400' : 'bg-green-500/10 text-green-400',
              )}
            >
              {offer.assignedInShift ? 'Sales only' : 'Paid hours + sales'}
            </span>
          </p>
        ) : offer.claimCount > 0 ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
            <Users className="size-3" aria-hidden />
            {offer.claims?.map(claim => (
              <span key={claim.userId} className="rounded bg-white/[0.08] px-1.5 py-px text-zinc-300">
                {claim.displayName}
              </span>
            )) ?? `${offer.claimCount} claimed`}
          </p>
        ) : (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-orange-400">
            <TriangleAlert className="size-3" aria-hidden />
            Nobody has claimed this yet
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isAssigned ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void release(false)} className="text-zinc-400">
                  <RotateCcw className="size-3.5" aria-hidden />
                  Unassign
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-56 text-center leading-relaxed">
                Deletes the shift this created and puts the account back on the board.
              </TooltipContent>
            </Tooltip>
          </>
        ) : (
          <>
            <Select
              value={picked}
              onValueChange={value => {
                setPicked(value);
                void assign(value);
              }}
              disabled={busy}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder="Assign to…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map(candidate => (
                  <SelectItem key={candidate.uid} value={candidate.uid}>
                    {candidate.displayName}
                    {candidate.claimed && <span className="ml-1.5 text-xs text-green-400">claimed</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void release(true)}
                  className="text-zinc-400 hover:text-red-400"
                  aria-label="Withdraw from the board"
                >
                  <X aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Withdraw — nobody needs to cover this</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </li>
  );
}
