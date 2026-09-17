'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FilterChip, SEGMENT_ITEM_CLASS } from './growthUi';
import { RefreshCountdown } from './postUi';
import { TrackPostBar } from './TrackPostBar';
import { PostsTable, type TableMetric } from './PostsTable';
import {
  METRIC_LABEL,
  ageHoursOf,
  refreshStateFor,
  soonestRefresh,
} from '@/lib/growth/postMetrics';
import type { GrowthPost, GrowthSpendLedger } from '@/types/firestore';

/**
 * Mounted only after a post has been opened, and dynamically imported: the sheet
 * carries the page's second recharts chart, which nobody who never opens a post
 * should pay to parse. The latch (rather than `openPost !== null`) is what keeps
 * the close animation — unmounting on close would make the sheet vanish instead
 * of sliding out.
 */
const PostDetailSheet = dynamic(
  () => import('./PostDetailSheet').then((m) => m.PostDetailSheet),
  { ssr: false },
);

/**
 * No `stopped` facet any more: this page is given only the posts still being
 * refreshed, so the chip counted nothing and led to an empty list. A stopped
 * post is not gone — its readings are kept, and the account panel still lists it
 * so it can be resumed on its own.
 */
type PostFilter = 'all' | 'live';

const FILTER_LABEL: Record<PostFilter, string> = {
  all: 'All posts',
  live: 'Moving now',
};

const TABLE_METRICS: TableMetric[] = ['engagement', 'likes', 'reposts', 'replies', 'views'];

/**
 * Tracked posts, roster-wide: paste a link, watch what it does.
 *
 * ── How this feels live without lying ───────────────────────────────────────
 * Readings land every 6, 12 or 24 hours depending on a post's age, so nothing on
 * this page can honestly claim to be current *right now*. Instead of faking it
 * with animated counters, the tab makes the schedule itself the visible, moving
 * thing: the strip below counts down to the next reading, every row states when
 * it was last read, and numbers only move when a genuinely new reading replaces
 * an old one. The result is a surface that is obviously running, and every
 * figure on it was measured.
 *
 * The spend figure sits in that same strip on purpose. Tracking posts costs
 * money per reading, and the person turning it on should see the bill in the
 * same glance as the data — not in a settings page nobody opens.
 */
export function PostsTab({
  posts,
  spend,
  loading,
  error,
  onRetry,
  onTrack,
  onSync,
  onSetTracking,
  onDelete,
  onLoadFullHistory,
}: {
  posts: GrowthPost[];
  spend: GrowthSpendLedger | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onTrack: (url: string) => Promise<void>;
  onSync: (id: string) => Promise<{ refreshedAlongside: number }>;
  onSetTracking: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLoadFullHistory: (id: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<PostFilter>('all');
  const [metric, setMetric] = useState<TableMetric>('engagement');
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [everOpened, setEverOpened] = useState(false);

  /**
   * Stable, so `PostRow`'s `memo` actually holds. Passed inline it was a new
   * function on every render — and since the highlight lives here, a mouse
   * sweep re-rendered every row in the body, which is the exact cost the memo
   * was added to avoid.
   */
  const openPostDetail = useCallback((post: GrowthPost) => {
    setOpenId(post.id);
    setEverOpened(true);
    // The sheet opens immediately on the trimmed series it already has; the
    // untrimmed one arrives a read later and replaces it.
    void onLoadFullHistory(post.id);
  }, [onLoadFullHistory]);

  const counts = useMemo(() => ({
    all: posts.length,
    // "Moving now" is the ladder's top rung — the posts still being read every
    // six hours, which is the only window where coming back tomorrow shows
    // something meaningfully different.
    live: posts.filter((p) => refreshStateFor(ageHoursOf(p.postedAt)) === 'live').length,
  }), [posts]);

  const visible = useMemo(() => (
    filter === 'live'
      ? posts.filter((post) => refreshStateFor(ageHoursOf(post.postedAt)) === 'live')
      : posts
  ), [posts, filter]);

  const nextReading = useMemo(() => soonestRefresh(posts), [posts]);

  // Read from the live array rather than held in state, so a sync updates the
  // open sheet in place instead of showing the copy captured when it opened.
  const openPost = useMemo(
    () => (openId === null ? null : posts.find((p) => p.id === openId) ?? null),
    [posts, openId],
  );

  return (
    <div className="space-y-4">
      <TrackPostBar onTrack={onTrack} disabled={loading} />

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          <span>{error}</span>
          <Button size="xs" variant="outline" onClick={onRetry}>Try again</Button>
        </div>
      )}

      {loading ? (
        <PostsSkeleton />
      ) : posts.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* The pulse strip. Three facts, one line: when the next reading
              lands, how much is being watched, and what it has cost. */}
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-white/[0.04] px-3 py-2.5 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-[11px] text-zinc-400">Next refresh</dt>
              <dd className="font-medium text-white">
                {nextReading === null
                  ? <span className="text-zinc-400">nothing scheduled</span>
                  : <RefreshCountdown to={nextReading} prefix="in " />}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-[11px] text-zinc-400">Tracked</dt>
              <dd className="tabular-nums text-zinc-200">{counts.all} refreshing</dd>
            </div>
            {spend && (
              <div className="flex items-baseline gap-2">
                <dt className="text-[11px] text-zinc-400">
                  Spent in {new Date(`${spend.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}
                </dt>
                <dd
                  className="tabular-nums text-zinc-200"
                  title={`${spend.results.toLocaleString('en-US')} refreshes across ${spend.runs} scraper calls`}
                >
                  ${spend.usd.toFixed(2)}
                </dd>
              </div>
            )}
          </dl>

          {/* Both controls filter or re-key everything below them, so they sit
              above the table — the same placement rule the overview follows. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['all', 'live'] as const).map((f) => (
                <FilterChip
                  key={f}
                  active={filter === f}
                  onClick={() => setFilter(f)}
                  count={counts[f]}
                >
                  {FILTER_LABEL[f]}
                </FilterChip>
              ))}
            </div>
            <ToggleGroup
              type="single"
              value={metric}
              onValueChange={(v) => v && setMetric(v as TableMetric)}
              variant="outline"
              size="sm"
              aria-label="Metric shown"
            >
              {TABLE_METRICS.map((m) => (
                <ToggleGroupItem key={m} value={m} className={SEGMENT_ITEM_CLASS}>
                  {m === 'engagement' ? 'Engagement' : METRIC_LABEL[m]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-zinc-400">
              No posts match {FILTER_LABEL[filter].toLowerCase()}.{' '}
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="text-zinc-300 underline underline-offset-2 transition-colors hover:text-white"
              >
                Show all {counts.all}
              </button>
              .
            </p>
          ) : (
            <PostsTable
              posts={visible}
              metric={metric}
              metricLabel={metric === 'engagement' ? 'Engagement' : METRIC_LABEL[metric]}
              highlightId={highlightId}
              onHighlight={setHighlightId}
              onOpen={openPostDetail}
            />
          )}

          <p className="max-w-[65ch] text-[11px] text-zinc-400">
            Posts refresh about every 6 hours for their first day, then every 12, then daily, then
            weekly, and stop after 30 days. Engagement can only ever be read as its value right
            now — there is no way to collect a post’s past.
          </p>
        </>
      )}

      {everOpened && (
        <PostDetailSheet
          post={openPost}
          onOpenChange={(open) => { if (!open) setOpenId(null); }}
          onSync={onSync}
          onSetTracking={onSetTracking}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

/**
 * The empty state teaches both routes in, because the second one is not
 * discoverable from this tab: nothing here hints that an account can be made to
 * find its own posts.
 */
function EmptyState() {
  // Two quiet lines, no box: a container drawn around a sentence implies there
  // is content in it (DESIGN.md §5). The copy teaches both routes in; the frame
  // was never doing any of that work.
  return (
    <div className="max-w-[62ch] space-y-1.5">
      <p className="text-sm font-medium text-zinc-200">No posts are tracked yet.</p>
      <p className="text-sm text-zinc-400">
        Paste an X post link above to start tracking one — it is refreshed straight away. Or turn
        on <span className="text-zinc-300">Find new posts automatically</span> for an X account —
        on its own page, or under Manage accounts — and its posts are picked up each night.
      </p>
    </div>
  );
}

/** Shaped to the real layout so nothing jumps when the data lands. */
function PostsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-11 rounded-lg" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-56 rounded-full" />
        <Skeleton className="h-8 w-72 rounded-lg" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
      </div>
    </div>
  );
}
