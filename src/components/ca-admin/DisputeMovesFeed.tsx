'use client';

/**
 * CA Admin → Sales — **Moved by dispute**, the panel the tab leads with.
 *
 * Since 2026-10-19 a dispute needs one approval: the agent holding the claimed
 * sales approves, and the sales move. The admin is no longer a gate, so their
 * question changes from "what must I rule on?" to "what just moved, and was it
 * right?" — this feed answers it, newest approval first, over the last 14 days
 * whatever period the ledger below is on.
 *
 * ## The shape (DESIGN.md §5, the decision queue — in its audit form)
 *
 * - **One row per claim**, grouped under day rails in the reader's zone. Line
 *   one is the move itself — amount, creator, *holder → filer* — and who
 *   approved it, when. Line two is the filer's argument in full, because it is
 *   the whole basis of the decision being audited. A Meta line appears only for
 *   what needs reading: a partial move, or an overturn.
 * - **The whole row opens the claim** (an `inset-0` overlay button; the action
 *   lane sits `relative` above it), so the per-sale detail and Un-transfer are
 *   one click away.
 * - **Overturn is on the row** and opens its reason in place under it — never a
 *   modal. Required: it takes back money an agent was told they have.
 * - **An overturned claim stays in the feed**, struck through and saying who
 *   overturned it and why, so a second admin is not left wondering where a move
 *   they saw went.
 * - **It never paginates.** The newest rows, then a link that puts the ledger
 *   on its Disputed view for the same 14 days — the feed is a glance; the
 *   ledger is the archive.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { formatRelative, formatSaleDateTime, localDayKey, pluralise } from '@/lib/salary/salaryFormat';
import { addDays, formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { useDisputesData } from '@/hooks/useDisputesData';
import type { DisputeDocument } from '@/types/firestore';
import { formatMoney, skipReasons } from '@/components/disputes/disputeStatus';
import { DisputeScope, LoadError, OVERTURN_COPY, PersonTag, RejectReasonBar } from '@/components/disputes/disputeUi';

export function DisputeMovesFeed({
  timezone,
  refreshKey,
  onOpen,
  onOverturn,
  onShowAll,
}: {
  timezone: string;
  /** Bumped by the page after any write that could change a move. */
  refreshKey: number;
  onOpen: (dispute: DisputeDocument) => void;
  /** Resolves once the overturn lands; throws (after toasting) on failure. */
  onOverturn: (dispute: DisputeDocument, reason: string) => Promise<void>;
  /** Put the ledger on its Disputed view for the same window. */
  onShowAll: (windowDays: number) => void;
}) {
  const { fetchMoved } = useDisputesData();
  const [disputes, setDisputes] = useState<DisputeDocument[]>([]);
  const [total, setTotal] = useState(0);
  // The window and row count are the server's (`/api/disputes`, admin-moved).
  const [windowDays, setWindowDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  /** Bumped by Retry; the page's `refreshKey` covers every other refetch. */
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchMoved()
      .then(result => {
        if (cancelled) return;
        setDisputes(result.disputes);
        setTotal(result.total);
        setWindowDays(result.windowDays);
        setError(false);
      })
      .catch(err => {
        if (cancelled) return;
        // A failed read is a state, never an empty feed (ca-salary.md §6).
        console.error('[DisputeMovesFeed] load failed:', err);
        setError(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchMoved, refreshKey, retryKey]);

  const days = useMemo(() => groupByDay(disputes, timezone), [disputes, timezone]);
  const more = total - disputes.length;

  return (
    <section aria-labelledby="moved-by-dispute" className={cn('rounded-xl px-4 pb-2 pt-3.5', SURFACE)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="moved-by-dispute" className="text-sm font-semibold">
          Moved by dispute
        </h3>
        <p className="text-xs text-zinc-400">
          {windowDays ? `Last ${windowDays} days` : 'Recent'}
          {!loading && !error && total > 0 && <> · <span className="tabular-nums">{pluralise(total, 'claim')}</span></>}
          {' · '}approved by the agent holding the sale
        </p>
      </div>

      {loading ? (
        <FeedSkeleton />
      ) : error ? (
        <LoadError
          onRetry={() => {
            setError(false);
            setLoading(true);
            setRetryKey(k => k + 1);
          }}
        />
      ) : disputes.length === 0 ? (
        <p className="py-3 text-sm text-zinc-400">Nothing has moved by dispute in the last {windowDays} days.</p>
      ) : (
        <>
          <ol className="mt-1">
            {days.map(day => (
              <li key={day.key}>
                <h4 className="pb-0.5 pt-2.5 text-xs font-medium text-zinc-400">{day.label}</h4>
                <ul className="divide-y divide-white/[0.07]">
                  {day.disputes.map(d => (
                    <MovedRow key={d.id} dispute={d} timezone={timezone} onOpen={onOpen} onOverturn={onOverturn} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {more > 0 && windowDays && (
            <div className="border-t border-white/[0.07] py-2">
              <Button size="xs" variant="ghost" className="h-7 text-zinc-300" onClick={() => onShowAll(windowDays)}>
                {pluralise(more, 'more claim')} in the last {windowDays} days — show them in the ledger
                <ArrowRight className="size-3" aria-hidden />
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── One move ────────────────────────────────────────────────────────

function MovedRow({
  dispute: d,
  timezone,
  onOpen,
  onOverturn,
}: {
  dispute: DisputeDocument;
  timezone: string;
  onOpen: (dispute: DisputeDocument) => void;
  onOverturn: (dispute: DisputeDocument, reason: string) => Promise<void>;
}) {
  const [overturning, setOverturning] = useState(false);
  const [busy, setBusy] = useState(false);

  const overturned = Boolean(d.overturnedAt) || d.AdminApproval === 'Rejected';
  const count = d.version === 2 ? d.sales.length : 1;
  const skipped = d.transferResult?.skipped ?? [];
  const moved = d.transferResult?.transferred.length ?? count;
  const reverted = d.untransfers.length;
  const money = formatMoney(d.saleAmount);
  const approver = approvedByLine(d);

  return (
    <li className="group/row relative -mx-2 rounded-md px-2 py-2.5 transition-colors duration-[120ms] hover:bg-white/[0.04]">
      {/* The whole row opens the claim; the action lane sits above this. */}
      <button
        type="button"
        onClick={() => onOpen(d)}
        aria-label={`Open the ${money} dispute ${d.createdByName || 'a former agent'} filed`}
        className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
      />

      <div className="pointer-events-none flex flex-col gap-x-4 gap-y-1 sm:flex-row sm:items-start">
        <span
          className={cn(
            'w-20 shrink-0 text-sm font-semibold tabular-nums sm:text-right',
            overturned && 'text-zinc-400 line-through decoration-zinc-500',
          )}
        >
          {money}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <DisputeScope dispute={d} />
            <span aria-hidden className="text-zinc-400">·</span>
            {/* The move itself: off the holder, onto the filer. */}
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <PersonTag name={d.assignedToName} photoURL={d.assignedToPhotoURL} size="sm" className="text-zinc-300" />
              <ArrowRight className="size-3 shrink-0 text-zinc-400" aria-label="moved to" />
              <PersonTag name={d.createdByName} photoURL={d.createdByPhotoURL} size="sm" className="font-medium" />
            </span>
          </div>

          {d.Comment && <p className="mt-1 max-w-[70ch] text-sm text-pretty text-zinc-400">{d.Comment}</p>}

          {overturned ? (
            <p className="mt-1 text-[11px] font-medium text-red-400">
              Overturned{d.overturnedByName ? ` by ${d.overturnedByName}` : ''}
              {d.overturnedAt && <> · {formatRelative(d.overturnedAt)}</>}
              {d.overturnReason && <> — “{d.overturnReason}”</>}
            </p>
          ) : (skipped.length > 0 || reverted > 0) && (
            <p className="mt-1 text-[11px] font-medium text-orange-400">
              {pluralise(moved, 'sale')} moved
              {skipped.length > 0 && <> · {skipped.length} not moved — {skipReasons(skipped)}</>}
              {reverted > 0 && <> · {reverted} reverted since</>}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 sm:min-h-6">
          <p className="text-[11px] text-zinc-400">
            {approver}
            {d.approvedAt && (
              <>
                {approver ? ' · ' : ''}
                <time dateTime={d.approvedAt} title={`${formatSaleDateTime(d.approvedAt, timezone)} · ${timezone}`} className="tabular-nums">
                  {formatRelative(d.approvedAt)}
                </time>
              </>
            )}
          </p>
          {!overturned && !overturning && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setOverturning(true)}
              aria-label={`Overturn the ${money} move to ${d.createdByName || 'a former agent'}`}
              className="pointer-events-auto relative h-6 text-red-400 hover:bg-red-500/10 hover:text-red-300 dark:hover:bg-red-500/10"
            >
              Overturn
            </Button>
          )}
        </div>
      </div>

      {overturning && (
        <div className="relative sm:pl-24">
          <RejectReasonBar
            id={`overturn-${d.id}`}
            busy={busy}
            copy={OVERTURN_COPY}
            onCancel={() => setOverturning(false)}
            onConfirm={async reason => {
              setBusy(true);
              try {
                await onOverturn(d, reason ?? '');
                setOverturning(false);
              } catch {
                // The page toasts; the bar stays open with the reason typed.
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      )}
    </li>
  );
}

/** "Approved by Marcus" — the holder, normally; an admin is named as one. */
function approvedByLine(d: DisputeDocument): string {
  if (d.approvedVia === 'ca') return `Approved by ${d.approvedByName || d.assignedToName || 'the holder'}`;
  if (d.approvedVia === 'admin') return `Approved by ${d.approvedByName || 'an admin'} (admin)`;
  // Approved before who-approved was recorded.
  return 'Approved';
}

// ─── Day rails ───────────────────────────────────────────────────────

function groupByDay(disputes: DisputeDocument[], timezone: string) {
  const today = localDayKey(Date.now(), timezone);
  const yesterday = addDays(today, -1);
  const groups: Array<{ key: string; label: string; disputes: DisputeDocument[] }> = [];
  for (const d of disputes) {
    const at = d.approvedAt ?? d.resolvedAt ?? d.createdAt;
    const key = at ? localDayKey(Date.parse(at), timezone) : 'unknown';
    let group = groups.find(g => g.key === key);
    if (!group) {
      const label = key === today ? 'Today' : key === yesterday ? 'Yesterday' : at ? formatDayLabelWithWeekday(key) : 'Earlier';
      group = { key, label, disputes: [] };
      groups.push(group);
    }
    group.disputes.push(d);
  }
  return groups;
}

function FeedSkeleton() {
  return (
    <div className="mt-3 space-y-4 pb-2" aria-busy>
      {[0, 1, 2].map(i => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-4 w-16 shrink-0 rounded" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-72 max-w-full rounded" />
            <Skeleton className="h-3.5 w-[28rem] max-w-full rounded" />
          </div>
          <Skeleton className="hidden h-3.5 w-32 rounded sm:block" />
        </div>
      ))}
    </div>
  );
}
