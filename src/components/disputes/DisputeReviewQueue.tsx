'use client';

/**
 * The review queue — "Disputes on your sales".
 *
 * This is the page's job, so it is a queue and not a table: each dispute is a
 * decision, and a decision needs the whole comment (the argument) and both
 * verdicts within reach. Approve is one click; Reject opens its reason field in
 * place, under the row it belongs to.
 *
 * The same component renders the resolved list, where `onAction` is absent and
 * the action lane carries the outcome pill instead.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EllipsisPagination } from '@/components/EllipsisPagination';
import type { DisputeDocument, ApprovalStatus } from '@/types/firestore';
import { formatMoney } from './disputeStatus';
import { PersonTag, SaleDate, StagePill, QuietLine, LoadError, RejectReasonBar } from './disputeUi';

export type DisputeVerdict = Extract<ApprovalStatus, 'Approved' | 'Rejected'>;

interface DisputeReviewQueueProps {
  disputes: DisputeDocument[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  userTimezone: string;
  /** Absent on the resolved list — the row then shows its outcome instead. */
  onAction?: (id: string, verdict: DisputeVerdict, reason?: string) => Promise<void>;
  emptyLine: string;
}

export function DisputeReviewQueue({
  disputes,
  loading,
  error,
  onRetry,
  page,
  totalPages,
  total,
  onPageChange,
  userTimezone,
  onAction,
  emptyLine,
}: DisputeReviewQueueProps) {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Unmounting the bar is what clears the typed reason — it owns that state, so
  // there is nothing else to reset here.
  const closeReject = () => setRejectingId(null);

  const run = async (id: string, verdict: DisputeVerdict, withReason?: string) => {
    setBusyId(id);
    try {
      await onAction!(id, verdict, withReason);
      closeReject();
    } catch {
      // The caller surfaces the failure as a toast. Keep the row and whatever
      // reason was typed so the decision isn't lost with it.
    } finally {
      setBusyId(null);
    }
  };

  if (error) return <LoadError onRetry={onRetry} />;
  if (loading) return <QueueSkeleton />;
  if (disputes.length === 0) return <QuietLine>{emptyLine}</QuietLine>;

  return (
    <div>
      <ul role="list" className="divide-y divide-white/[0.07]">
        {disputes.map(d => {
          const busy = busyId === d.id;
          const rejecting = rejectingId === d.id;

          return (
            <li key={d.id} className="py-4 first:pt-1">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold tabular-nums text-white">
                      {formatMoney(d.saleAmount)}
                    </span>
                    <span aria-hidden className="text-zinc-400">·</span>
                    <SaleDate iso={d.saleDate} timezone={userTimezone} className="text-sm text-zinc-400" />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-400">
                    <span className="truncate">
                      Fan <span className="text-zinc-300">{d.fanName}</span>
                    </span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1.5">
                      Creator
                      <PersonTag name={d.creatorName} photoURL={d.creatorPhotoURL} size="sm" className="text-zinc-300" />
                    </span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1.5">
                      Filed by
                      <PersonTag name={d.createdByName} photoURL={d.createdByPhotoURL} size="sm" className="text-zinc-300" />
                    </span>
                  </div>

                  {d.Comment && (
                    <p className="max-w-[70ch] text-sm text-pretty text-zinc-400">{d.Comment}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {onAction ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || rejecting}
                        onClick={() => run(d.id, 'Approved')}
                        className="border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300 dark:bg-green-500/10 dark:hover:bg-green-500/20"
                      >
                        {busy && !rejecting ? 'Approving…' : 'Approve'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setRejectingId(rejecting ? null : d.id)}
                        aria-expanded={rejecting}
                        aria-controls={`reject-${d.id}`}
                        className="text-red-400 hover:bg-red-500/10 hover:text-red-300 dark:hover:bg-red-500/10"
                      >
                        Reject
                      </Button>
                    </>
                  ) : (
                    <StagePill dispute={d} />
                  )}
                </div>
              </div>

              {rejecting && (
                <div id={`reject-${d.id}`} className="mt-1">
                  <RejectReasonBar
                    id={d.id}
                    busy={busy}
                    onCancel={closeReject}
                    onConfirm={r => run(d.id, 'Rejected', r)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <FeedFooter shown={disputes.length} total={total} page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}

// ─── Footer (count + pagination) ──────────────────────────────────────

export function FeedFooter({
  shown,
  total,
  page,
  totalPages,
  onPageChange,
}: {
  shown: number;
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] tabular-nums text-zinc-400">
        {totalPages > 1 ? `Showing ${shown} of ${total}` : `${total} ${total === 1 ? 'dispute' : 'disputes'}`}
      </p>
      <EllipsisPagination page={page} totalPages={totalPages} onPageChange={onPageChange} className="m-0" />
    </div>
  );
}

// ─── Skeleton — shaped to the row above, so nothing jumps ─────────────

function QueueSkeleton() {
  return (
    <ul role="list" className="divide-y divide-white/[0.07]">
      {[0, 1, 2].map(i => (
        <li key={i} className="flex items-start justify-between gap-6 py-4 first:pt-1">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-3 w-72" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
          <div className="flex shrink-0 gap-2">
            <Skeleton className="h-8 w-[88px] rounded-md" />
            <Skeleton className="h-8 w-[72px] rounded-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}
