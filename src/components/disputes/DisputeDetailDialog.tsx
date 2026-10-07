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
import { DisputeCreatorChip, PersonTag, StagePill, RejectReasonBar, type ReasonBarCopy } from './disputeUi';
import type { DisputeVerdict } from './DisputeReviewQueue';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { AttrChip, FanLabel } from '@/components/buddyx/buddyxUi';
import { formatSaleDateTime } from '@/lib/salary/salaryFormat';
import { saleTypeLabel } from '@/lib/salary/saleTypes';

const UNTRANSFER_COPY: ReasonBarCopy = {
  label: 'Why this transfer is being reverted',
  placeholder: 'Reason (required) — recorded on the dispute',
  confirm: 'Revert transfer',
  busy: 'Reverting…',
  required: true,
};

/** "2 tips moved to Jenelle's sales · 1 skipped — month finalised". */
function describeTransfer(dispute: DisputeDocument): string | null {
  const result = dispute.transferResult;
  if (!result) return null;
  const who = dispute.createdByName ? `${dispute.createdByName}'s` : "the filer's";
  const moved = result.transferred.length;
  const parts = [`${moved} ${moved === 1 ? 'tip' : 'tips'} moved to ${who} sales`];
  const reasons = [...new Set(result.skipped.map(s => s.reason))];
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped — ${reasons.join(', ')}`);
  return parts.join(' · ');
}

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
  onUntransfer,
}: {
  /** Null between closing and the exit animation finishing. */
  dispute: DisputeDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  /** Absent unless the viewer is the assigned reviewer and it is still open. */
  onAction?: (id: string, verdict: DisputeVerdict, reason?: string) => Promise<void>;
  /**
   * CA Admin only: revert one transferred tip — the escape hatch for a wrong
   * approval. Offered per moved tip on an approved v2 dispute.
   */
  onUntransfer?: (saleId: string, reason: string) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);

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
                  <span className="ml-1.5 text-xs font-normal tracking-normal text-zinc-400">gross</span>
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
              {dispute.version === 1 && (
                <>
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
                </>
              )}

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

            {/* A v2 claim names its tips; each one's state is what the admin's
                approval did to it. */}
            {dispute.version === 2 && dispute.sales.length > 0 && (
              <div className={cn('border-t pt-4', HAIRLINE)}>
                <h3 className="text-xs font-semibold text-zinc-400">
                  {dispute.sales.length === 1 ? 'The tip' : `${dispute.sales.length} tips`}
                  {dispute.groupSize > 1 && (
                    <span className="font-normal">
                      {' '}· filed with {dispute.groupSize - 1} other {dispute.groupSize === 2 ? 'dispute' : 'disputes'}
                    </span>
                  )}
                </h3>
                <ul className="mt-2 max-h-56 divide-y divide-white/[0.07] overflow-y-auto">
                  {dispute.sales.map(sale => {
                    const moved = dispute.transferResult?.transferred.includes(sale.saleId) ?? false;
                    const skipped = dispute.transferResult?.skipped.find(x => x.saleId === sale.saleId);
                    const reverted = dispute.untransfers.find(u => u.saleId === sale.saleId);
                    const state = reverted ? 'Reverted' : moved ? 'Moved' : skipped ? `Skipped — ${skipped.reason}` : null;
                    return (
                      <li key={sale.saleId} className="py-1.5">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="w-28 shrink-0 tabular-nums text-zinc-400">
                            {sale.occurredAt ? formatSaleDateTime(sale.occurredAt, timezone) : '—'}
                          </span>
                          {sale.creatorId ? <CreatorChip creatorId={sale.creatorId} size="xs" avatarOnly /> : null}
                          <AttrChip>{saleTypeLabel(sale.type)}</AttrChip>
                          <FanLabel name={sale.fanName} fanId={sale.fanId} className="min-w-0 flex-1" />
                          <span className="shrink-0 tabular-nums">{formatMoney(sale.gross)}</span>
                        </div>
                        {(state || (moved && !reverted && onUntransfer)) && (
                          <div className="mt-0.5 flex items-center justify-end gap-2 text-[11px] text-zinc-400">
                            {state && <span>{state}</span>}
                            {moved && !reverted && onUntransfer && reverting !== sale.saleId && (
                              <Button
                                size="xs"
                                variant="ghost"
                                className="h-6 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                onClick={() => setReverting(sale.saleId)}
                              >
                                Un-transfer
                              </Button>
                            )}
                          </div>
                        )}
                        {reverting === sale.saleId && onUntransfer && (
                          <RejectReasonBar
                            id={`untransfer-${sale.saleId}`}
                            busy={busy}
                            copy={UNTRANSFER_COPY}
                            onCancel={() => setReverting(null)}
                            onConfirm={async reason => {
                              setBusy(true);
                              try {
                                await onUntransfer(sale.saleId, reason ?? '');
                                setReverting(null);
                              } catch {
                                // The caller toasts; the reason stays typed.
                              } finally {
                                setBusy(false);
                              }
                            }}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {describeTransfer(dispute) && <p className="mt-2 text-sm">{describeTransfer(dispute)}</p>}
              </div>
            )}

            {dispute.version === 1 && stage === 'approved' && (
              <p className={cn('border-t pt-4 text-sm text-zinc-400', HAIRLINE)}>
                Legacy dispute — adjust manually. Disputes filed before the BuddyX integration move nothing when approved.
              </p>
            )}

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
