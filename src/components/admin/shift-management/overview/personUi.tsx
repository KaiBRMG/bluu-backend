'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { STATE_CONFIG } from '@/lib/stateColors';
import { STATUS_DOT } from '@/lib/campaignTracking';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import type { AttentionTone, LiveSession } from '@/lib/shiftOverview';

/** Seeded from `displayName`, always (DESIGN.md — The Avatar Seed Rule). */
export function PersonAvatar({
  displayName,
  photoURL,
  size = 'sm',
  className,
}: {
  displayName: string;
  photoURL?: string | null;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  const seed = displayName || 'User';
  return (
    <Avatar size={size} className={className} style={{ background: getAvatarColor(seed) }} aria-hidden>
      {photoURL && <AvatarImage src={photoURL} alt="" />}
      <AvatarFallback style={{ background: getAvatarColor(seed), color: '#fff' }}>
        {getInitials(seed)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Severity hue for a queue line. Borrowed from the status palette, never
 * re-typed: red is a failure, orange waits on a person, yellow is a review.
 */
const TONE_DOT: Record<AttentionTone, string> = {
  red: STATUS_DOT.Rejected,
  orange: STATUS_DOT['Awaiting Approval'],
  // The status palette's "attention needed" step has no STATUS_DOT key.
  yellow: 'bg-yellow-400',
};

const TONE_WORD: Record<AttentionTone, string> = {
  red: 'Urgent',
  orange: 'Needs a look',
  yellow: 'Review',
};

export function ToneDot({ tone, className }: { tone: AttentionTone; className?: string }) {
  return (
    <>
      <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', TONE_DOT[tone], className)} />
      <span className="sr-only">{TONE_WORD[tone]}:</span>
    </>
  );
}

/** The timer's own vocabulary for a live state — colour from STATE_CONFIG, plus the word. */
export function LiveStateLabel({
  session,
  since,
  className,
}: {
  session: LiveSession | undefined;
  since?: string;
  className?: string;
}) {
  const key = session ? session.currentState : 'clocked-out';
  const cfg = STATE_CONFIG[key];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-zinc-400', className)}>
      <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: cfg.color }} />
      <span className="text-zinc-200">{cfg.label}</span>
      {since && <span className="tabular-nums">· {since}</span>}
    </span>
  );
}
