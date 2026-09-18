'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { HAIRLINE } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import type { DisputeDocument } from '@/types/firestore';
import {
  disputeStage,
  formatMoney,
  formatSaleDate,
  STAGE_HINT,
} from './disputeStatus';
import { DisputeCreatorChip, PersonTag, StagePill, RejectReasonBar } from './disputeUi';
import type { DisputeVerdict } from './DisputeReviewQueue';

/**
 * One dispute, in full.
 *
 * The dashboard column is deliberately four facts wide — amount, creator,
 * filer, date — because a column that showed everything would show nothing
 * legibly. This is where the rest lives: the fan the sale came from, the exact
 * time in the reader's own zone, who is reviewing it, and the filer's argument
 * in full.
 *
 * ## Why the verdict is here too
 *
 * A reviewer who opens a dispute to read the argument has already decided they
 * need more than the row gave them — sending them back out to the column to
 * press a 28px tick is a trip for nothing, and the two would then disagree
 * about which control is the real one. Approve and Reject render here on
 * exactly the same terms as the column: only when the viewer is the assigned
 * reviewer and the dispute is still open, using the same shared reason bar
 * (DESIGN.md §5, the decision queue).
 *
 * ## It is not a second source of truth
 *
 * The dialog holds no dispute of its own. It renders whatever `dispute` it is
 * handed and reports a verdict upward; the panel owns the list, the refetch and
 * the toast. That is what stops a ruling landing here and the column behind it
 * still offering the same sale.
 */

export function DisputeDetailDialog({
  dispute,
  open,
  onOpenChange,
  timezone,
  onAction,
}: {
  /** Null between closing and the exit animation finishing. */
  dispute: DisputeDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  /** Absent unless the viewer is the assigned reviewer and it is still open. */
  onAction?: (id: string, verdict: DisputeVerdict, reason?: string) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (verdict: DisputeVerdict, reason?: string) => {
    if (!dispute) return;
    setBusy(true);
    try {
      await onAction!(dispute.id, verdict, reason);
      setRejecting(false);
      onOpenChange(false);
    } catch {
      // The caller toasts the failure. The dialog stays open with the reason
      // still typed, so the decision is not lost with the request.
    } finally {
      setBusy(false);
    }
  };

  const stage = dispute ? disputeStage(dispute) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // Reset on close, not on open: reopening the *same* dispute with a
        // half-typed rejection reason still showing is a decision the reviewer
        // did not make this time.
        if (!next) setRejecting(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {dispute && (
          <>
            <DialogHeader className="pr-10">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <DialogTitle className="text-2xl font-semibold tabular-nums tracking-tight">
                  {formatMoney(dispute.saleAmount)}
                </DialogTitle>
                <StagePill dispute={dispute} />
              </div>
              <DialogDescription className="mt-1">
                {stage ? STAGE_HINT[stage] : null}
              </DialogDescription>
            </DialogHeader>

            {/* A hairline-separated definition list rather than five boxed
                rows — the same shape the salary card uses for its evidence,
                and the reason neither needs a nested card to say "these five
                facts belong together". */}
            <dl className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 border-t pt-4 text-sm', HAIRLINE)}>
              <dt className="text-zinc-400">Sale</dt>
              <dd className="tabular-nums">
                {formatSaleDate(dispute.saleDate, timezone)}
                <span className="ml-1.5 text-xs text-zinc-400">{timezone}</span>
              </dd>

              <dt className="text-zinc-400">Fan</dt>
              <dd className="truncate" title={dispute.fanName}>{dispute.fanName}</dd>

              <dt className="text-zinc-400">Creator</dt>
              <dd className="min-w-0">
                <DisputeCreatorChip dispute={dispute} />
              </dd>

              <dt className="text-zinc-400">Claimed by</dt>
              <dd className="min-w-0">
                <PersonTag name={dispute.createdByName} photoURL={dispute.createdByPhotoURL} />
              </dd>

              <dt className="text-zinc-400">Reviewer</dt>
              <dd className="min-w-0">
                <PersonTag name={dispute.assignedToName} photoURL={dispute.assignedToPhotoURL} />
              </dd>

              {/* Only on a dispute that has actually been ruled on, and absent
                  on everything settled before `resolvedAt` existed — an empty
                  row would read as "decided: unknown" rather than as a field
                  this record predates. */}
              {dispute.resolvedAt && (
                <>
                  <dt className="text-zinc-400">Decided</dt>
                  <dd className="tabular-nums">{formatSaleDate(dispute.resolvedAt, timezone)}</dd>
                </>
              )}
            </dl>

            {/* The argument is the whole basis of the decision, so it is never
                truncated (DESIGN.md §5, the decision queue). */}
            {dispute.Comment && (
              <div className={cn('border-t pt-4', HAIRLINE)}>
                <h3 className="text-xs font-semibold text-zinc-400">Their reason</h3>
                <p className="mt-1.5 max-w-[70ch] text-sm text-pretty">{dispute.Comment}</p>
              </div>
            )}

            {onAction && (
              <div className={cn('border-t pt-4', HAIRLINE)}>
                {rejecting ? (
                  <RejectReasonBar
                    id={`detail-${dispute.id}`}
                    busy={busy}
                    onCancel={() => setRejecting(false)}
                    onConfirm={reason => void run('Rejected', reason)}
                  />
                ) : (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setRejecting(true)}
                      className="text-red-400 hover:bg-red-500/10 hover:text-red-300 dark:hover:bg-red-500/10"
                    >
                      Reject
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run('Approved')}
                      className="border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300 dark:bg-green-500/10 dark:hover:bg-green-500/20"
                    >
                      {busy ? 'Approving\u2026' : 'Approve'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
