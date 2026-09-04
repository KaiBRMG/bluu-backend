'use client';

/**
 * Presentational atoms shared by the CA disputes queue and ledger.
 *
 * Deliberately NOT `UserChip`: that component renders an `outline` Button, so
 * every name on the page looks pressable and none of them are. Here a person is
 * text with an avatar beside it — DESIGN.md §5, Avatar Seed Rule (seed the
 * fallback from the same display name everywhere).
 */

import type { ReactNode } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
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
