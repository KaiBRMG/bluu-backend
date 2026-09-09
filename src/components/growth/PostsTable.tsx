'use client';

import { memo, useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Sparkline } from './Sparkline';
import {
  AnimatedCount, PostAuthorAvatar, ReadFreshness, RefreshStatePill, VelocityValue, postExcerpt,
} from './postUi';
import {
  metricValue,
  pointsForMetric,
  velocityFor,
  type PostMetric,
  type PostVelocity,
} from '@/lib/growth/postMetrics';
import type { SeriesPoint } from '@/lib/growth/metrics';
import type { GrowthPost } from '@/types/firestore';

export type TableMetric = PostMetric | 'engagement';
type SortKey = 'posted' | 'value' | 'rate';

/**
 * The reading surface for tracked posts. It carries the construction of the
 * follower leaderboard this subsystem used to have, because the lessons that
 * shaped it were paid for once already:
 *
 *  - A real `<table>` with sortable `<th>`s carrying `aria-sort`.
 *  - The interactive element is the **post excerpt inside the first cell**, not
 *    `role="button"` on the `<tr>` — that overrides the `row` role, orphans the
 *    cells, and takes the sortable headers' column associations with them. The
 *    row keeps its own click handler for the mouse.
 *  - The focus ring lives on that button, because a `box-shadow` ring on a
 *    `<tr>` is never painted under the `border-collapse: collapse` Tailwind's
 *    preflight sets on every table.
 *  - Rows are transparent on the canvas, so they take the overlay hover steps
 *    rather than `brightness` (DESIGN.md § Interaction).
 *
 * The metric selector above decides what the number column, the rate column and
 * the sparkline all describe — one choice, three columns — which is the same
 * idiom as the range control on the overview rather than eight columns of
 * numbers nobody can scan.
 */

interface PostsTableProps {
  posts: GrowthPost[];
  metric: TableMetric;
  metricLabel: string;
  highlightId: string | null;
  onHighlight: (id: string | null) => void;
  onOpen: (post: GrowthPost) => void;
}

export function PostsTable({
  posts, metric, metricLabel, highlightId, onHighlight, onOpen,
}: PostsTableProps) {
  const [sort, setSort] = useState<SortKey>('posted');
  const [ascending, setAscending] = useState(false);

  const rows = useMemo(() => {
    const mapped = posts.map((post) => ({
      post,
      value: post.latest ? metricValue(post.latest, metric) : null,
      velocity: velocityFor(post.history, metric),
      spark: pointsForMetric(post.history, metric).map(
        (p): SeriesPoint => ({ date: p.t, value: p.value }),
      ),
    }));

    const direction = ascending ? 1 : -1;
    return mapped.sort((a, b) => {
      if (sort === 'posted') {
        // A post with no publish time sinks either way — it is unplaced in the
        // timeline, not the oldest thing in it.
        const at = a.post.postedAt ? Date.parse(a.post.postedAt) : null;
        const bt = b.post.postedAt ? Date.parse(b.post.postedAt) : null;
        if (at === null && bt === null) return 0;
        if (at === null) return 1;
        if (bt === null) return -1;
        return (at - bt) * direction;
      }
      // Unmeasured rows sink in both directions: a post the scraper has not
      // reported this metric for is not "the worst performer", it is unknown.
      const value = (r: typeof mapped[number]) =>
        sort === 'value' ? r.value : r.velocity?.perDay ?? null;
      const av = value(a);
      const bv = value(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * direction;
    });
  }, [posts, metric, sort, ascending]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setAscending((v) => !v);
    else { setSort(key); setAscending(false); }
  };

  if (posts.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHead label="Post" active={sort === 'posted'} ascending={ascending} onClick={() => toggleSort('posted')} sortLabel="posted" />
            <SortHead label={metricLabel} align="right" active={sort === 'value'} ascending={ascending} onClick={() => toggleSort('value')} />
            <SortHead label="Rate" align="right" active={sort === 'rate'} ascending={ascending} onClick={() => toggleSort('rate')} />
            <TableHead className="w-[110px] text-right">Trend</TableHead>
            <TableHead className="w-[100px] text-right">Last refresh</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ post, value, velocity, spark }) => (
            <PostRow
              key={post.id}
              post={post}
              value={value}
              metricKey={metric}
              velocity={velocity}
              spark={spark}
              isHighlighted={post.id === highlightId}
              onHighlight={onHighlight}
              onOpen={onOpen}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Memoised for the same reason the leaderboard's row is: the highlight lives on
 * the tab, so a mouse sweep down the table would otherwise re-render and re-path
 * every sparkline in the body on each row entered, when two rows changed.
 */
const PostRow = memo(function PostRow({
  post, value, metricKey, velocity, spark, isHighlighted, onHighlight, onOpen,
}: {
  post: GrowthPost;
  value: number | null;
  /** Which metric `value` measures — a change snaps the count instead of tweening. */
  metricKey: TableMetric;
  velocity: PostVelocity | null;
  spark: SeriesPoint[];
  isHighlighted: boolean;
  onHighlight: (id: string | null) => void;
  onOpen: (post: GrowthPost) => void;
}) {
  const posted = post.postedAt
    ? new Date(post.postedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'Date unknown';

  return (
    <TableRow
      onMouseEnter={() => onHighlight(post.id)}
      onMouseLeave={() => onHighlight(null)}
      onClick={() => onOpen(post)}
      // No opacity on a stopped row: its text is already at Ink Secondary, and
      // dimming it further drops under the 4.5:1 floor. The "Stopped" pill in
      // the first cell carries that state without costing legibility (DESIGN.md,
      // The One De-emphasis Rule).
      className={`cursor-pointer transition-colors ${
        isHighlighted ? 'bg-[#3b82f6]/15' : 'hover:bg-white/[0.055] active:bg-white/[0.08]'
      }`}
    >
      <TableCell className="max-w-0">
        <div className="flex min-w-0 items-start gap-2.5">
          <PostAuthorAvatar post={post} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              // The row already handles the mouse; letting this bubble would
              // open the sheet twice.
              onClick={(e) => { e.stopPropagation(); onOpen(post); }}
              onFocus={() => onHighlight(post.id)}
              onBlur={() => onHighlight(null)}
              aria-label={`Post by @${post.authorHandle ?? 'unknown'} — open details`}
              className={`block w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] ${
                isHighlighted ? 'font-medium text-white' : 'text-zinc-300'
              }`}
            >
              {postExcerpt(post.text)}
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
              <span className="truncate">@{post.authorHandle ?? 'unknown'}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{posted}</span>
              <RefreshStatePill post={post} />
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right align-middle">
        <AnimatedCount value={value} subject={metricKey} className="text-zinc-100" />
      </TableCell>
      <TableCell className="text-right align-middle">
        <VelocityValue velocity={velocity} className="text-xs" />
      </TableCell>
      <TableCell className="text-right align-middle">
        <div className="flex justify-end">
          <Sparkline points={spark} highlighted={isHighlighted} />
        </div>
      </TableCell>
      <TableCell className="text-right align-middle">
        <ReadFreshness post={post} />
      </TableCell>
    </TableRow>
  );
});

function SortHead({
  label, active, ascending, onClick, align = 'left', sortLabel,
}: {
  label: string;
  active: boolean;
  ascending: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
  sortLabel?: string;
}) {
  return (
    // aria-sort belongs to the column header, not the control inside it — the
    // role that owns the property is `columnheader`, which is the <th>.
    <TableHead
      className={align === 'right' ? 'text-right' : undefined}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        // TableHead inks `text-foreground`, so stepping to zinc-300 on hover
        // would make the engaged states *dimmer* than rest. Rest sits at Ink
        // Secondary; both engaged states step up to white.
        className={`inline-flex items-center gap-1 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-white' : 'text-zinc-400'}`}
      >
        {label}
        {sortLabel && <span className="sr-only"> — sort by {sortLabel}</span>}
        {active && (ascending
          ? <ArrowUpIcon className="size-3" aria-hidden />
          : <ArrowDownIcon className="size-3" aria-hidden />)}
      </button>
    </TableHead>
  );
}
