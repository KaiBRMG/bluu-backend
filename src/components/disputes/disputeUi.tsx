'use client';

/**
 * Presentational atoms shared by the CA disputes queue and ledger.
 *
 * Deliberately NOT `UserChip`: that component renders an `outline` Button, so
 * every name on the page looks pressable and none of them are. Here a person is
 * text with an avatar beside it — DESIGN.md §5, Avatar Seed Rule (seed the
 * fallback from the same display name everywhere).
 */

import { useState, type ReactNode } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DeletedUser } from '@/components/DeletedUser';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import {
  disputeStage,
  stagePillClass,
  STAGE_LABEL,
  STAGE_HINT,
  formatSaleDate,
  type DisputeStage,
  type DisputeStageInput,
} from './disputeStatus';

// ─── PersonTag ────────────────────────────────────────────────────────

export function PersonTag({
  name,
  photoURL,
  size = 'default',
  className,
}: {
  name: string;
  photoURL: string | null;
  /** `sm` is the meta-line step (11px); `default` sits on a table row. */
  size?: 'sm' | 'default';
  className?: string;
}) {
  // 'No One' is the unassigned sentinel — it routes straight to an admin.
  if (name === 'No One') {
    return <span className={cn('text-zinc-400', className)}>No reviewer</span>;
  }
  if (!name) {
    return (
      <span className={className}>
        <DeletedUser />
      </span>
    );
  }

  const avatarSize = size === 'sm' ? 'size-4' : 'size-5';
  const initialsSize = size === 'sm' ? 'text-[8px]' : 'text-[10px]';

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar className={cn(avatarSize, 'shrink-0')} style={{ background: getAvatarColor(name) }}>
        {photoURL && <AvatarImage src={photoURL} alt="" />}
        <AvatarFallback
          className={initialsSize}
          style={{ background: getAvatarColor(name), color: '#fff' }}
        >
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  );
}

// ─── StagePill ────────────────────────────────────────────────────────

export function StagePill({ dispute }: { dispute: DisputeStageInput }) {
  const stage: DisputeStage = disputeStage(dispute);
  return (
    <span
      title={STAGE_HINT[stage]}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        stagePillClass(stage),
      )}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}

// ─── SaleDate ─────────────────────────────────────────────────────────

/**
 * Sale times are the whole argument in a dispute ("this landed after my
 * shift"), so the zone they are read in is part of the value, not trivia —
 * it rides along on `title`.
 */
export function SaleDate({
  iso,
  timezone,
  className,
}: {
  iso: string | null;
  timezone: string;
  className?: string;
}) {
  const formatted = formatSaleDate(iso, timezone);
  if (!iso) return <span className={cn('text-zinc-400', className)}>—</span>;
  return (
    <time
      dateTime={iso}
      title={`${formatted} · ${timezone}`}
      className={cn('tabular-nums whitespace-nowrap', className)}
    >
      {formatted}
    </time>
  );
}

// ─── Quiet states ─────────────────────────────────────────────────────

/** One line, no box — DESIGN.md §5, Loading & Empty States. */
export function QuietLine({ children }: { children: ReactNode }) {
  return <p className="py-8 text-sm text-zinc-400">{children}</p>;
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-2 py-8 text-sm text-zinc-400">
      Couldn&apos;t load these disputes.
      <button
        type="button"
        onClick={onRetry}
        className="rounded-sm text-white underline underline-offset-2 transition-colors hover:text-white/80 focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
      >
        Try again
      </button>
    </p>
  );
}

// ─── RejectReasonBar ──────────────────────────────────────────────────

/** The filer reads this verbatim, so it is a line, not a paragraph. */
export const REASON_MAX = 50;

/**
 * The reason field for a rejection, opened in place under the row it belongs to.
 *
 * One component for every surface that rejects a dispute — the wide queue, the
 * dashboard column, the detail dialog. DESIGN.md §5 fixes the behaviour (a bar
 * on the overlay recipe under its own row, never a modal, `Esc` cancels,
 * `Enter` confirms) and three copies of it is how one of them quietly loses the
 * `Esc` handler.
 *
 * **The typed reason lives here, not in the parent.** A failed write keeps the
 * bar mounted, so the words survive the failure without the parent having to
 * hold them — which is what the queue used to do, and what the column would
 * otherwise have had to re-implement.
 */
export function RejectReasonBar({
  id,
  busy,
  onCancel,
  onConfirm,
  /** `stack` is the narrow-column form: the field above its own buttons. */
  layout = 'row',
}: {
  id: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
  layout?: 'row' | 'stack';
}) {
  const [reason, setReason] = useState('');
  const confirm = () => onConfirm(reason.trim() || undefined);

  return (
    <div
      className={cn(
        'mt-2 flex flex-col gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] p-2.5',
        layout === 'row' && 'sm:flex-row sm:items-center sm:p-3',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor={`reason-${id}`} className="sr-only">
          Reason for rejecting this dispute
        </label>
        <Input
          id={`reason-${id}`}
          autoFocus
          value={reason}
          maxLength={REASON_MAX}
          placeholder="Reason (optional) — the filer sees this"
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && !busy) confirm();
          }}
          className="h-8"
        />
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
          {reason.length}/{REASON_MAX}
        </span>
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy} className="text-zinc-400 hover:text-white">
          Cancel
        </Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={confirm}>
          {busy ? 'Rejecting…' : 'Confirm reject'}
        </Button>
      </div>
    </div>
  );
}
