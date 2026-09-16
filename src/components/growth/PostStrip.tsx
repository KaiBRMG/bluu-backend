'use client';

import { memo } from 'react';
import { Sparkline } from './Sparkline';
import { AnimatedCount, RefreshStatePill, VelocityValue, postExcerpt } from './postUi';
import type { SeriesPoint } from '@/lib/growth/metrics';
import type { PostVelocity } from '@/lib/growth/postMetrics';
import type { TableMetric } from './PostsTable';
import type { GrowthPost } from '@/types/firestore';

/**
 * One tracked post, as a strip inside the account panel.
 *
 * ── Why a strip rather than the table ───────────────────────────────────────
 * `PostsTable` is five columns wide and carries three sortable headers. Inside a
 * 672px panel those columns collapse into each other and the header row costs
 * more height than two posts. This is the same information at panel width: one
 * post, one row, everything the table's five columns said — excerpt, the
 * selected metric, its rate, its trend, when it was posted and whether it is
 * still being refreshed.
 *
 * ── It is the account card, compressed ──────────────────────────────────────
 * Deliberately built on `AccountCard`'s construction, because a post inside an
 * account is the same kind of object one level down: a thing with a headline
 * number, a rate, and a shape over time. What it drops is what the card only
 * needed because it sat in a grid — the avatar (every post here has the same
 * author, so a column of identical faces states nothing), the two-line stacked
 * layout, and the card's own padding. What it gains is the magnitude bar.
 *
 * ── The magnitude bar ───────────────────────────────────────────────────────
 * `share` widens a translucent Action Blue wash behind the row in proportion to
 * the best post in the list on the selected metric — the house idiom for ranking
 * a list of rows ([`SalesReport`](src/components/salary/SalesReport.tsx)'s
 * `By creator` list), and the thing that answers "which of these actually
 * worked" before any number is read. It is kept translucent for the reason the
 * shaded matrix states: an opaque fill would paint over the row's own hover wash
 * and hovering would go patchy. It encodes the value and nothing else, so it
 * does not breach the Semantic-Only Rule.
 *
 * A row with no reading for this metric gets no bar at all — `share` is `null`,
 * not `0`. A zero-width bar and "we have never measured this" would look
 * identical, which is the gap-invention this subsystem bans everywhere else.
 *
 * ── The whole strip is the button ───────────────────────────────────────────
 * The same call as `AccountCard`, and for the same reason: there is nothing else
 * interactive inside it. (The table makes the opposite call because
 * `role="button"` on a `<tr>` orphans its cells — no `<tr>` here.)
 */
export const PostStrip = memo(function PostStrip({
  post,
  metric,
  value,
  velocity,
  spark,
  share,
  onOpen,
}: {
  post: GrowthPost;
  /** Which metric `value` measures — a change snaps the count instead of tweening. */
  metric: TableMetric;
  value: number | null;
  velocity: PostVelocity | null;
  spark: SeriesPoint[];
  /** This post's value as a fraction of the list's best, or `null` if unmeasured. */
  share: number | null;
  onOpen: (post: GrowthPost) => void;
}) {
  const posted = post.postedAt
    ? new Date(post.postedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'Date unknown';

  return (
    <button
      type="button"
      onClick={() => onOpen(post)}
      // The overlay recipe, so it takes the overlay hover steps rather than a
      // brightness nudge (DESIGN.md § Interaction).
      className="relative flex w-full items-start gap-3 overflow-hidden rounded-lg bg-white/[0.04] px-3 py-2.5 text-left
        transition-colors duration-[120ms] ease-out
        hover:bg-white/[0.055] active:bg-white/[0.08]
        focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] focus-visible:outline-none"
    >
      {share !== null && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-lg bg-action-blue/[0.12]"
          style={{ width: `${Math.max(share * 100, 1.5)}%` }}
        />
      )}

      <span className="relative min-w-0 flex-1">
        <span className="line-clamp-2 text-[13px] leading-snug text-zinc-200">
          {postExcerpt(post.text, 160)}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
          <span className="tabular-nums">{posted}</span>
          <RefreshStatePill post={post} />
        </span>
      </span>

      <span className="relative flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-2">
          {/* Greyscale on purpose: the figure beside it already carries the fact,
              and the bar behind the row is the one thing on this strip allowed to
              speak in colour. */}
          <Sparkline points={spark} width={160} height={18} className="w-14" />
          <AnimatedCount
            value={value}
            subject={metric}
            className="text-base font-semibold text-zinc-100"
          />
        </span>
        <VelocityValue velocity={velocity} className="text-[11px]" />
      </span>
    </button>
  );
});
