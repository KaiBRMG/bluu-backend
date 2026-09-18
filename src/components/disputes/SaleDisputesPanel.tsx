'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { CheckIcon, CircleAlert, PlusIcon, RotateCcw, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBootPhase } from '@/contexts/BootLoaderContext';
import { useDisputeSummary } from '@/hooks/useDisputeSummary';
import { useDisputesData } from '@/hooks/useDisputesData';
import { HAIRLINE, SURFACE } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import type { DisputeDocument } from '@/types/firestore';
import {
  DISPUTES_OPEN_ALL_PARAM,
  disputeStage,
  formatMoney,
  formatSaleDateCompact,
  STAGE_LABEL,
  stagePillClass,
} from './disputeStatus';
import { DisputeCreatorChip, PersonTag, RejectReasonBar } from './disputeUi';
import { DisputeDetailDialog } from './DisputeDetailDialog';
import type { DisputeVerdict } from './DisputeReviewQueue';

/**
 * Sale Disputes — the dashboard's second column.
 *
 * ## Why disputes moved onto the dashboard
 *
 * `/ca-portal/disputes` was a whole page for a queue that is empty most days,
 * and it was the only place an agent could learn that a sale they had claimed
 * was decided. So they had to *remember to go and look* at a page that usually
 * had nothing on it — precisely the page nobody opens. Meanwhile the dashboard,
 * which they do open, ran at `max-w-5xl` with a third of the window unused
 * beside it.
 *
 * The queue now lives in that space and the page is a redirect. Everything the
 * page could do is one click away in the All-disputes dialog; this column is
 * the part with a deadline on it.
 *
 * ## What the column says, in priority order
 *
 * 1. **Needs your review.** Someone has claimed one of your sales; until you
 *    rule, they are not paid for it. The only block with buttons.
 * 2. **Decided.** What happened to the claims *you* filed. The decision
 *    notification is coalesced and lands in a tray (ca-salary.md §11), so this
 *    is the reliable channel — the same reasoning, and the same 14-day
 *    dismissible treatment, as `LeaveBalanceCard`'s leave decisions.
 * 3. **Your open disputes.** What is still open, and which desk it sits on.
 *
 * Decided sits above open on purpose: an outcome is news, a pending claim is
 * not, and the reader was already told about the pending one when they filed it.
 *
 * ## The compact card is a row, not a card
 *
 * It rests on the panel at the list-item overlay step (DESIGN.md §4) rather
 * than carrying a border of its own. A bordered card inside a bordered panel is
 * a nested card, which this system does not do — and at 23rem the two frames
 * would eat most of the width they enclose.
 */

const DISMISSED_KEY = 'bluu_dispute_decisions_seen_v1';

/**
 * Did the reader arrive from the `/ca-portal/disputes` redirect?
 *
 * That route is all five dispute notifications' `actionUrl` and forwards here
 * carrying `?disputes=1`, so a message written months ago still lands its
 * reader in front of their disputes rather than their payslip.
 *
 * Read **lazily, as initial state** rather than in an effect that then calls
 * `setState` — the same shape as `readDismissed` and `LeaveBalanceCard`'s
 * dismissal list, and for the same reason: the effect version renders the
 * dashboard once without the dialog and immediately again with it, which is a
 * visible flash of the page the reader did not ask for. `useSearchParams` is
 * avoided deliberately; it would drag a Suspense boundary onto a dashboard
 * that has no other reason for one.
 */
function arrivedFromDisputesLink(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URL(window.location.href).searchParams.has(DISPUTES_OPEN_ALL_PARAM);
  } catch {
    return false;
  }
}

/** Every dispute row rests at this overlay step and deepens on interaction. */
const ROW =
  'rounded-lg bg-white/[0.04] transition-colors duration-[120ms] ' +
  'hover:bg-white/[0.055] focus-within:bg-white/[0.055]';

/**
 * Which decisions this browser has already acknowledged.
 *
 * Wrapped like `LeaveBalanceCard`'s: `localStorage` throws outright in a
 * private window and with site data blocked, and failing to an empty list shows
 * a decision again rather than hiding the only place it reliably appears.
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

// The workspace pulls in two feeds, the tables and the pagination; the create
// form pulls in the calendar and the pickers. Neither is the column, and
// neither is needed until someone asks for it.
const AllDisputesDialog = dynamic(
  () => import('./AllDisputesDialog').then(m => m.AllDisputesDialog),
);
const CreateDisputeDialog = dynamic(
  () => import('./CreateDisputeDialog').then(m => m.CreateDisputeDialog),
);

// ─── Panel ────────────────────────────────────────────────────────────

export function SaleDisputesPanel({
  timezone,
  className,
}: {
  timezone: string;
  className?: string;
}) {
  const { summary, loading, refreshing, error, refetch } = useDisputeSummary();

  // `lookups` is only armed once the create form has been asked for, so the
  // dashboard does not fetch the creator roster and the CA list for a dialog
  // most visits never open (CLAUDE.md rule 9).
  const [createMounted, setCreateMounted] = useState(false);
  const { creators, caUsers, createDispute, setCaApproval } = useDisputesData({
    lookups: createMounted,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [allMounted, setAllMounted] = useState(arrivedFromDisputesLink);
  const [allOpen, setAllOpen] = useState(arrivedFromDisputesLink);
  const [detail, setDetail] = useState<DisputeDocument | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  // Async dashboard widgets gate the boot screen so the page paints complete
  // rather than with one column still in its skeleton (CLAUDE.md rule 8).
  useBootPhase('ca-dispute-summary', loading);

  const openDetail = useCallback((dispute: DisputeDocument) => {
    setDetail(dispute);
    setDetailOpen(true);
  }, []);

  const rule = useCallback(async (id: string, verdict: DisputeVerdict, reason?: string) => {
    try {
      await setCaApproval(id, verdict, reason);
      toast.success(verdict === 'Approved' ? 'Dispute approved' : 'Dispute rejected');
      // Refetched rather than spliced out locally: a ruling changes the count
      // in the heading and can move the dispute into the filer's Decided list,
      // and an optimistic removal would leave that heading lying until the next
      // window focus.
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update this dispute');
      throw err;
    }
  }, [setCaApproval, refetch]);

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = [...prev, id];
      try {
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-50)));
      } catch {
        /* see readDismissed */
      }
      return next;
    });
  }, []);

  const decided = useMemo(
    () => (summary?.decided ?? []).filter(d => !dismissed.includes(d.id)),
    [summary, dismissed],
  );

  const review = summary?.review;
  const mine = summary?.mine;
  const hiddenReview = review ? Math.max(0, review.total - review.disputes.length) : 0;
  const hiddenMine = mine ? Math.max(0, mine.total - mine.disputes.length) : 0;

  const openAll = useCallback(() => {
    setAllMounted(true);
    setAllOpen(true);
  }, []);

  const openCreate = useCallback(() => {
    setCreateMounted(true);
    setCreateOpen(true);
  }, []);

  // Consume the parameter once the dialog it opened is mounted. This is a
  // write to an external system (the address bar), not a render input — and it
  // is what stops the dialog reopening every time the reader navigates back to
  // the dashboard for the rest of the session.
  useEffect(() => {
    if (!allMounted) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(DISPUTES_OPEN_ALL_PARAM)) return;
    url.searchParams.delete(DISPUTES_OPEN_ALL_PARAM);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [allMounted]);

  // Whether the *detail* dialog may rule: the same test the column uses, so the
  // two can never offer different verdicts on the same sale.
  const detailActionable = Boolean(detail && review?.disputes.some(d => d.id === detail.id));

  return (
    <section
      className={cn('rounded-xl p-4', SURFACE, className)}
      aria-labelledby="sale-disputes-heading"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="sale-disputes-heading" className="text-sm font-semibold">
            Sale Disputes
          </h2>
          <p className="mt-0.5 text-xs text-pretty text-zinc-400">
            Rule on sales claimed off your report, and follow the ones you raised.
          </p>
        </div>

        {/* Icon-only and `aria-label`-named, deliberately without a tooltip:
            the error and skeleton branches reuse this header and neither sits
            inside a TooltipProvider — same reasoning as the calendar's refresh. */}
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => void refetch()}
          disabled={refreshing || loading}
          aria-label={refreshing ? 'Refreshing disputes' : 'Refresh disputes'}
          className="shrink-0 text-zinc-400"
        >
          <RotateCcw className={cn(refreshing && 'activity-spinner animate-spin')} aria-hidden />
        </Button>
      </div>

      {/* A failed read is a state, never an empty list (ca-salary.md §6). It
          renders above whatever is already on screen rather than replacing it:
          stale rows an agent can still act on beat a column that reads as
          "nothing to do" because the network hiccuped. */}
      {error && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-red-400">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {error}
          <Button
            size="xs"
            variant="ghost"
            className="ml-0.5 text-red-400 hover:text-red-300"
            onClick={() => void refetch()}
          >
            <RotateCcw className="size-3" aria-hidden />
            Retry
          </Button>
        </p>
      )}

      {/* No payload and an error means the blocks below would be asserting
          "nothing waiting on you" about a list nobody has read — the exact
          confident-negative failure ca-salary.md §6 is written about. The error
          line above is the whole state until a read succeeds. */}
      {loading ? (
        <PanelSkeleton />
      ) : !summary ? null : (
        <div className="mt-4 flex flex-col gap-5">
          {/* ── 1. Needs your review ── */}
          <Block
            title="Needs your review"
            count={review?.total ?? 0}
            countTone="waiting"
            emptyLine="Nothing waiting on you."
          >
            {review?.disputes.map(d => (
              <ReviewCard
                key={d.id}
                dispute={d}
                timezone={timezone}
                onOpen={openDetail}
                onAction={rule}
              />
            ))}
            {hiddenReview > 0 && (
              <MoreLink key="more-review" onClick={openAll} label={`View all ${review?.total ?? 0}`} />
            )}
          </Block>

          {/* ── 2. Recently decided ── */}
          {decided.length > 0 && (
            <Block title="Recently decided">
              {decided.map(d => (
                <DecidedRow key={d.id} dispute={d} onOpen={openDetail} onDismiss={dismiss} />
              ))}
            </Block>
          )}

          {/* ── 3. Your open disputes ── */}
          {(mine?.total ?? 0) > 0 && (
            <Block title="Your open disputes" count={mine?.total ?? 0}>
              {mine?.disputes.map(d => (
                <ClaimRow key={d.id} dispute={d} timezone={timezone} onOpen={openDetail} />
              ))}
              {hiddenMine > 0 && (
                <MoreLink key="more-mine" onClick={openAll} label={`View all ${mine?.total ?? 0}`} />
              )}
            </Block>
          )}
        </div>
      )}

      <div className={cn('mt-5 grid grid-cols-2 gap-2 border-t pt-4', HAIRLINE)}>
        <Button size="sm" variant="outline" onClick={openCreate}>
          <PlusIcon aria-hidden />
          New dispute
        </Button>
        <Button size="sm" variant="ghost" className="text-zinc-400 hover:text-white" onClick={openAll}>
          All disputes
        </Button>
      </div>

      <DisputeDetailDialog
        dispute={detail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        timezone={timezone}
        onAction={detailActionable ? rule : undefined}
      />

      {allMounted && (
        <AllDisputesDialog
          open={allOpen}
          onOpenChange={next => {
            setAllOpen(next);
            // The dialog rules on the same disputes this column lists, so the
            // column re-reads when it closes. Without this, approving inside
            // the dialog leaves the card outside it still offering the sale.
            if (!next) void refetch();
          }}
          timezone={timezone}
          onNewDispute={openCreate}
        />
      )}

      {createMounted && (
        <CreateDisputeDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          creators={creators}
          caUsers={caUsers}
          onSubmit={async payload => {
            await createDispute(payload);
            toast.success('Dispute submitted');
            await refetch();
          }}
        />
      )}
    </section>
  );
}

// ─── Blocks ───────────────────────────────────────────────────────────

function Block({
  title,
  count,
  countTone = 'neutral',
  emptyLine,
  children,
}: {
  title: string;
  count?: number;
  /**
   * `waiting` tints the count orange — the hue this subsystem already uses for
   * "waiting on a person" (`disputeStatus`'s `STAGE_HUE`, and the leave card's
   * pending pill one panel over). It is reserved for a count that is somebody
   * else's blocked work; a tally of your own open claims is neutral, because
   * nothing about it is owed by the reader.
   */
  countTone?: 'neutral' | 'waiting';
  /** Rendered when the block has no rows. Omit on blocks that hide instead. */
  emptyLine?: string;
  children?: ReactNode;
}) {
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);

  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <h3 className="text-xs font-semibold">{title}</h3>
        {count !== undefined && count > 0 && (
          <span
            className={cn(
              'text-xs tabular-nums',
              countTone === 'waiting'
                ? 'rounded-full bg-orange-500/10 px-1.5 py-0.5 font-medium text-orange-400'
                : 'text-zinc-400',
            )}
          >
            {count}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        // One quiet line, no box (DESIGN.md §5) — and nothing at all for a
        // block that declared no empty state, rather than a paragraph holding
        // `undefined` and its own margin.
        emptyLine ? <p className="mt-2 text-xs text-zinc-400">{emptyLine}</p> : null
      ) : (
        <ul role="list" className="mt-2 flex flex-col gap-1.5">
          {rows}
        </ul>
      )}
    </div>
  );
}

function MoreLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        // `min-h-6` rather than padding: this sits in a list of rows, not in a
        // run of prose, so WCAG 2.5.8's inline-link exception does not cover it
        // and the label alone is ~16px tall.
        className="inline-flex min-h-6 items-center rounded-sm text-xs text-zinc-400 underline-offset-2 transition-colors duration-[120ms] hover:text-white hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {label}
      </button>
    </li>
  );
}

// ─── Rows ─────────────────────────────────────────────────────────────

/**
 * The whole row opens the dispute, via an overlay that fills it.
 *
 * The alternative — making the text block a button beside the verdict lane —
 * leaves a dead strip under the buttons and another in the gap, on a row that
 * is ~56px tall. The overlay is `inset-0` and the trailing controls sit above
 * it, so every pixel that is not a verdict opens the dispute.
 */
function RowShell({
  children,
  action,
  openLabel,
  onOpen,
}: {
  children: ReactNode;
  action?: ReactNode;
  openLabel: string;
  onOpen: () => void;
}) {
  return (
    <div className={cn('relative flex items-center gap-2 p-2', ROW)}>
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 rounded-lg focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="sr-only">{openLabel}</span>
      </button>

      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="relative flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  );
}

/** Amount + creator: the two facts that identify a sale at a glance. */
function RowIdentity({ dispute }: { dispute: DisputeDocument }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-sm font-semibold tabular-nums">
        {formatMoney(dispute.saleAmount)}
      </span>
      <span aria-hidden className="text-zinc-400">·</span>
      <DisputeCreatorChip dispute={dispute} size="xs" className="min-w-0 text-zinc-300" />
    </div>
  );
}

function ReviewCard({
  dispute,
  timezone,
  onOpen,
  onAction,
}: {
  dispute: DisputeDocument;
  timezone: string;
  onOpen: (d: DisputeDocument) => void;
  onAction: (id: string, verdict: DisputeVerdict, reason?: string) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (verdict: DisputeVerdict, reason?: string) => {
    setBusy(true);
    try {
      await onAction(dispute.id, verdict, reason);
      setRejecting(false);
    } catch {
      // Toasted by the caller. The row and the typed reason stay put.
    } finally {
      setBusy(false);
    }
  };

  const money = formatMoney(dispute.saleAmount);
  const filer = dispute.createdByName || 'a deleted user';

  return (
    <li>
      <RowShell
        openLabel={`Open the ${money} dispute from ${filer}`}
        onOpen={() => onOpen(dispute)}
        action={
          <>
            {/* Approve is the affirmative outline, Reject a bare ghost —
                DESIGN.md §5 weights the affirmative path and halves the colour
                mass. At `icon-sm` both clear WCAG 2.5.8's 24px floor. */}
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy || rejecting}
              onClick={() => void run('Approved')}
              aria-label={`Approve the ${money} dispute from ${filer}`}
              className="border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300 dark:bg-green-500/10 dark:hover:bg-green-500/20"
            >
              <CheckIcon aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setRejecting(r => !r)}
              aria-expanded={rejecting}
              aria-controls={`reject-col-${dispute.id}`}
              aria-label={`Reject the ${money} dispute from ${filer}`}
              className="text-red-400 hover:bg-red-500/10 hover:text-red-300 dark:hover:bg-red-500/10"
            >
              <XIcon aria-hidden />
            </Button>
          </>
        }
      >
        <RowIdentity dispute={dispute} />
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
          <PersonTag
            name={dispute.createdByName}
            photoURL={dispute.createdByPhotoURL}
            size="sm"
            className="min-w-0"
          />
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">
            {formatSaleDateCompact(dispute.saleDate, timezone)}
          </span>
        </div>
      </RowShell>

      {rejecting && (
        // Namespaced: the All-disputes dialog can be open over this column with
        // its own bar on the same dispute, and two elements sharing an id make
        // both `aria-controls` ambiguous.
        <div id={`reject-col-${dispute.id}`}>
          <RejectReasonBar
            id={`col-${dispute.id}`}
            busy={busy}
            layout="stack"
            onCancel={() => setRejecting(false)}
            onConfirm={reason => void run('Rejected', reason)}
          />
        </div>
      )}
    </li>
  );
}

function ClaimRow({
  dispute,
  timezone,
  onOpen,
}: {
  dispute: DisputeDocument;
  timezone: string;
  onOpen: (d: DisputeDocument) => void;
}) {
  const stage = disputeStage(dispute);

  return (
    <li>
      <RowShell
        openLabel={`Open your ${formatMoney(dispute.saleAmount)} dispute, ${STAGE_LABEL[stage].toLowerCase()}`}
        onOpen={() => onOpen(dispute)}
      >
        <RowIdentity dispute={dispute} />
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px]">
          <span
            className={cn('shrink-0 rounded-full px-1.5 py-px font-medium', stagePillClass(stage))}
          >
            {STAGE_LABEL[stage]}
          </span>
          <span className="truncate tabular-nums text-zinc-400">
            {formatSaleDateCompact(dispute.saleDate, timezone)}
          </span>
        </div>
      </RowShell>
    </li>
  );
}

/**
 * A verdict on one of your claims, until you acknowledge it.
 *
 * The outcome is carried by the **word**, not the hue — the same rule as the
 * calendar's leave badge and `LeaveBalanceCard`'s decision pills. Green and red
 * at 11px on a dimmed screen is not a distinction someone should have to make
 * about whether they were paid.
 */
function DecidedRow({
  dispute,
  onOpen,
  onDismiss,
}: {
  dispute: DisputeDocument;
  onOpen: (d: DisputeDocument) => void;
  onDismiss: (id: string) => void;
}) {
  const stage = disputeStage(dispute);
  const approved = stage === 'approved';
  const money = formatMoney(dispute.saleAmount);
  const outcome = approved
    ? 'Approved — moving to your report'
    : stage === 'declined-ca'
      ? `Declined by ${dispute.assignedToName || 'the reviewer'}`
      : 'Rejected by an admin';
  // The visible string carries an em dash, which a screen reader announces as
  // "em dash". Same fact, punctuated for the ear.
  const spoken = approved ? 'approved, moving to your report' : outcome.toLowerCase();

  return (
    <li>
      <RowShell
        openLabel={`Open your ${money} dispute, ${spoken}`}
        onOpen={() => onOpen(dispute)}
        action={
          <button
            type="button"
            onClick={() => onDismiss(dispute.id)}
            aria-label={`Dismiss the outcome of your ${money} dispute`}
            className={cn(
              'relative rounded-full p-1 text-zinc-400 transition-colors duration-[120ms]',
              'hover:bg-white/[0.08] hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              // The glyph is 10px and the row has no height to give it; the
              // target is expanded past the icon instead (WCAG 2.5.8).
              'after:absolute after:-inset-2 after:content-[""]',
            )}
          >
            <XIcon className="size-2.5" aria-hidden />
          </button>
        }
      >
        <RowIdentity dispute={dispute} />
        <p
          className={cn(
            'mt-0.5 truncate text-[11px] font-medium',
            approved ? 'text-green-400' : 'text-red-400',
          )}
        >
          {outcome}
        </p>
      </RowShell>
    </li>
  );
}

// ─── Skeleton — shaped to the blocks above, so nothing jumps ──────────

function PanelSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-5">
      {[0, 1].map(block => (
        <div key={block}>
          <Skeleton className="h-3.5 w-28 rounded" />
          <div className="mt-2 flex flex-col gap-1.5">
            {[0, 1].map(row => (
              <Skeleton key={row} className="h-14 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
