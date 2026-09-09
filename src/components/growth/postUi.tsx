'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import { formatCount } from '@/lib/growth/metrics';
import {
  REFRESH_STATE_LABEL,
  ageHoursOf,
  formatAge,
  formatCountdown,
  formatVelocity,
  isFrozenRefreshAt,
  refreshStateFor,
  type PostVelocity,
  type RefreshState,
} from '@/lib/growth/postMetrics';
import type { GrowthPost } from '@/types/firestore';

/**
 * Shared marks for the post-analytics surfaces, and the two primitives that
 * carry this page's entire "live" story.
 *
 * ═══ WHAT IS ALLOWED TO MOVE, AND WHY ═══
 *
 * Readings arrive every 6, 12 or 24 hours. The page must still feel like an
 * instrument rather than a printout, and the honest way to do that is to animate
 * only what is genuinely true between readings:
 *
 *  1. **Time.** `nextRefreshAt` is a timestamp the server has already committed
 *     to, so counting down to it is a fact that stays true with no new
 *     information. `RefreshCountdown` is the page's pulse.
 *  2. **The distance between two measured readings.** When a sync lands,
 *     `AnimatedCount` tweens from the previous *observed* value to the new
 *     *observed* value. Both endpoints were measured; the motion is a transition
 *     between two facts, not an invention of the values in between.
 *
 * What is banned, permanently: extrapolating a counter forward from a velocity
 * to make numbers tick while nothing is being read. Engagement velocity decays
 * sharply, so the projection overshoots and the next real reading lands as a
 * visible drop — a page that appears to lose data. It would also make a
 * screenshot of a fabricated number indistinguishable from a measured one, on a
 * surface people quote from. See `postMetrics.ts`.
 */

// ─── Ticking, without re-rendering the page ──────────────────────────

/**
 * A slow clock for relative-time strings ("4h ago").
 *
 * 30 seconds, not one: these strings change once a minute at the very fastest,
 * and this **is** a React state update, so every consumer re-renders on it.
 * CLAUDE.md's navigation known-issue #2 is precisely this pattern at 1 Hz
 * interrupting pending transitions — a page-wide second-by-second tick is not
 * something to add here.
 */
export function useSlowTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

/**
 * A one-second countdown to the next reading that **never re-renders React**.
 *
 * The interval writes `textContent` straight to the node, which is the fix
 * CLAUDE.md prescribes for the 1 Hz `TimeTrackingContext` tick and for the same
 * reason: React interrupts pending transitions per-root, so a per-second state
 * update anywhere on the page can preempt a navigation no matter where it sits
 * in the tree. A ticking clock must not be able to make the sidebar feel stuck.
 */
export const RefreshCountdown = memo(function RefreshCountdown({
  to,
  className,
  prefix = '',
}: {
  to: string | number | null;
  className?: string;
  prefix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const frozen = typeof to === 'string' && isFrozenRefreshAt(to);
  const target = to === null || frozen
    ? null
    : typeof to === 'number' ? to : Date.parse(to);

  useEffect(() => {
    if (target === null || !Number.isFinite(target)) return;

    const paint = () => {
      if (ref.current) ref.current.textContent = prefix + formatCountdown(target - Date.now());
    };
    paint();
    const id = setInterval(paint, 1000);
    return () => clearInterval(id);
  }, [target, prefix]);

  if (frozen) return <span className={cn('text-zinc-400', className)}>no more refreshes</span>;
  if (target === null || !Number.isFinite(target)) {
    return <span className={cn('text-zinc-400', className)}>not scheduled</span>;
  }

  // Rendered with a placeholder rather than the real remaining time, because
  // reading the clock during render is impure: the server and the first client
  // paint would disagree and React would report a hydration mismatch. The effect
  // above fills it on the frame after mount. It is a placeholder rather than an
  // empty node so the line does not collapse and reflow for that one frame.
  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}&hellip;
    </span>
  );
});

/**
 * A number that tweens when it changes and is otherwise perfectly still.
 *
 * Like the countdown, the animation is written to the DOM rather than run
 * through state — 40 frames of `setState` per changed cell would be the same
 * transition-interrupting hazard, multiplied by every row in the table.
 *
 * The first render never animates: arriving data is not a change, and a table
 * that counts up from zero on load is the fake-liveness move this page exists to
 * avoid.
 *
 * Neither does a change of `subject`. The tween only means something when both
 * endpoints measure the SAME thing — switching the table from views to likes
 * replaces 48,201 with 961, and animating that would draw a collapse that never
 * happened. Pass whatever identifies the quantity (the metric, the post id) and
 * a change to it snaps instead of tweening.
 */
export const AnimatedCount = memo(function AnimatedCount({
  value,
  subject,
  className,
}: {
  value: number | null;
  subject?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef<number | null>(value);
  const previousSubject = useRef<string | undefined>(subject);

  useEffect(() => {
    const node = ref.current;
    const from = previous.current;
    const sameSubject = previousSubject.current === subject;
    previous.current = value;
    previousSubject.current = subject;

    if (!node || value === null) return;
    if (from === null || from === value || !sameSubject) {
      node.textContent = formatCount(value);
      return;
    }

    const reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      node.textContent = formatCount(value);
      return;
    }

    const start = performance.now();
    const duration = 520;
    let raf = 0;

    const step = (at: number) => {
      const t = Math.min(1, (at - start) / duration);
      // ease-out-quart: the house curve. No bounce, no elastic.
      const eased = 1 - Math.pow(1 - t, 4);
      node.textContent = formatCount(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, subject]);

  if (value === null) return <span className={cn('text-zinc-400', className)}>—</span>;
  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {formatCount(value)}
    </span>
  );
});

// ─── Identity ────────────────────────────────────────────────────────

/**
 * The post author's picture, scraped inside the already-billed result.
 *
 * Seeded from the author handle, which is the only name a post carries. The
 * Avatar Seed Rule (DESIGN.md §5) names `displayName` because that is the field
 * on a `users` doc; what it protects is that one identity hashes to one colour
 * on every surface, and here the handle is that identity — the same seed the
 * account avatars use, so a post and its account render the same colour.
 */
export function PostAuthorAvatar({
  post,
  className,
}: {
  post: Pick<GrowthPost, 'authorHandle' | 'authorProfilePictureUrl'>;
  className?: string;
}) {
  const seed = post.authorHandle || 'Post';
  return (
    <Avatar className={cn('size-6 shrink-0', className)}>
      {post.authorProfilePictureUrl && (
        <AvatarImage src={post.authorProfilePictureUrl} alt="" />
      )}
      <AvatarFallback
        className="text-[10px] font-medium"
        style={{ background: getAvatarColor(seed), color: '#fff' }}
      >
        {getInitials(seed)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * The post's own words, collapsed to one line.
 *
 * Newlines become spaces rather than being preserved: a table row is one line
 * tall, and a post whose first line is an emoji would otherwise render as an
 * empty cell with the actual content clipped below it.
 */
export function postExcerpt(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return 'No text';
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ─── State marks ─────────────────────────────────────────────────────

/**
 * Where a post sits on the refresh ladder. Greyscale for every state except
 * `live` — the ladder is a category, not a status, and colouring five rungs
 * would spend hue on something no one needs to scan for. `live` earns the one
 * Action Blue tint because it is the only rung where the numbers are still
 * moving fast enough to be worth coming back to.
 */
export function RefreshStatePill({
  post,
  now,
}: {
  post: Pick<GrowthPost, 'postedAt' | 'isActive'>;
  now?: Date;
}) {
  if (!post.isActive) {
    return (
      <span className="shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
        Stopped
      </span>
    );
  }

  const state: RefreshState = refreshStateFor(ageHoursOf(post.postedAt, now));
  const isLive = state === 'live';
  return (
    <span
      title={REFRESH_STATE_LABEL[state]}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        isLive ? 'bg-[#3b82f6]/15 text-[#93c5fd]' : 'bg-white/[0.08] text-zinc-300',
      )}
    >
      {isLive && (
        // A steady dot, not a pulsing one. A blinking indicator on a surface
        // that reads every six hours claims a tempo the data does not have.
        <span className="size-1.5 rounded-full bg-[#60a5fa]" aria-hidden />
      )}
      {LADDER_LABEL[state]}
    </span>
  );
}

const LADDER_LABEL: Record<RefreshState, string> = {
  live: 'Live',
  hourly: '12h',
  daily: 'Daily',
  weekly: 'Weekly',
  frozen: 'Frozen',
};

/**
 * When this post's numbers were actually taken.
 *
 * The page's honesty valve: everything else on screen is a number without a
 * timestamp, and this is what stops that being a claim of liveness. Quiet when
 * healthy, loud only when a read has failed — a status pill on every row trains
 * people to stop reading the column, which is the column's only job.
 */
export function ReadFreshness({
  post,
  className,
}: {
  post: Pick<GrowthPost, 'lastReadAt' | 'lastReadStatus' | 'lastReadError'>;
  className?: string;
}) {
  // Subscribed so "4h ago" is not frozen at whatever it said when the tab
  // mounted. 30s granularity, well under the smallest unit rendered.
  useSlowTick();

  if (post.lastReadStatus === 'failed') {
    return (
      <span
        className={cn('rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400', className)}
        title={post.lastReadError ?? undefined}
      >
        Refresh failed
      </span>
    );
  }
  if (!post.lastReadAt) {
    return <span className={cn('text-[11px] text-zinc-400', className)}>First refresh soon</span>;
  }
  return (
    <span className={cn('text-[11px] tabular-nums text-zinc-400', className)}>
      {formatAge(post.lastReadAt)}
    </span>
  );
}

/**
 * A measured rate of change, with the window it was measured over in the title.
 *
 * `null` — fewer than two readings — renders as an em dash, never as zero. "We
 * have not measured this twice yet" and "this did not move" are different facts,
 * and a 0 that means the first is a lie the reader cannot detect (the same rule
 * `DeltaValue` follows for followers).
 */
export function VelocityValue({
  velocity,
  className,
}: {
  velocity: PostVelocity | null;
  className?: string;
}) {
  if (!velocity) {
    return (
      <span
        className={cn('tabular-nums text-zinc-400', className)}
        title="A rate needs two refreshes — there is only one so far"
      >
        —
      </span>
    );
  }

  const tone = velocity.change > 0
    ? 'text-green-400'
    : velocity.change < 0 ? 'text-red-400' : 'text-zinc-400';

  return (
    <span
      className={cn('tabular-nums', tone, className)}
      title={`Measured over the ${velocity.hours < 1
        ? `${Math.round(velocity.hours * 60)} minutes`
        : `${velocity.hours.toFixed(1)} hours`} between the last two refreshes`}
    >
      {formatVelocity(velocity.perDay)}
    </span>
  );
}
