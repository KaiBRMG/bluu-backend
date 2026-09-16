'use client';

import { useCallback, useMemo, useState } from 'react';
import { ExternalLinkIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import {
  AccountAvatar, CategoryDot, DeltaValue, PlatformChip, SEGMENT_ITEM_CLASS,
  ScrapeFailedBadge, SpikeBadge,
} from './growthUi';
import { RefreshCountdown } from './postUi';
import { TrackPostBar } from './TrackPostBar';
import { PostStrip } from './PostStrip';
import { PostDetailBody } from './PostDetailSheet';
import { useTrackPosts } from './useTrackPosts';
import type { TableMetric } from './PostsTable';
import {
  RANGE_DAYS, RANGE_LABEL, deltaFor, formatCompact, formatCount, pointsFor, rangeStart,
  type DayMap, type GrowthRange, type SeriesPoint,
} from '@/lib/growth/metrics';
import { spikePercent } from '@/lib/growth/signals';
import {
  METRIC_LABEL, metricValue, pointsForMetric, soonestRefresh, velocityFor,
} from '@/lib/growth/postMetrics';
import { PLATFORM_LABEL } from '@/lib/growth/platform';
import type { TrackPostsResult } from '@/hooks/useGrowthTracking';
import type { GrowthAccount, GrowthPost } from '@/types/firestore';

const chartConfig = { followers: { label: 'Followers', color: '#3b82f6' } } satisfies ChartConfig;

/** Same five as the table's, with the panel-width labels the post view uses. */
const PANEL_METRICS: TableMetric[] = ['engagement', 'likes', 'reposts', 'replies', 'views'];

const METRIC_CHIP: Record<TableMetric, string> = {
  engagement: 'Total',
  likes: METRIC_LABEL.likes,
  reposts: METRIC_LABEL.reposts,
  replies: METRIC_LABEL.replies,
  views: METRIC_LABEL.views,
  quotes: METRIC_LABEL.quotes,
  bookmarks: METRIC_LABEL.bookmarks,
};

type PostSort = 'top' | 'new';

/**
 * One account, inside the panel — and the panel's first of two levels.
 *
 * ── Why it went back to being a sheet ───────────────────────────────────────
 * It was a full-width page for one reason: `PostsTable`, five columns and three
 * sortable headers, does not fit in a panel. Replacing that table with
 * [`PostStrip`](./PostStrip.tsx) removes the reason. What is bought back is the
 * thing a full-page detail costs and cannot give back — the roster stays on
 * screen behind the panel, so opening an account is a peek rather than a
 * departure, and moving between accounts does not bounce through an overview
 * you just left. The post detail was already a panel; now the two levels are the
 * same object rather than a page and an overlay on top of it.
 *
 * ── Order of the contents is an argument about priority ─────────────────────
 * Controls first, then the number, then the posts, then the facts:
 *
 *  1. **Controls.** The two things that cost money and change what the system
 *     does — post discovery, and pasting a link to track. They were at the very
 *     bottom of the page version, below a table, which put the page's only
 *     decisions behind its longest read.
 *  2. **Followers**, with its own range control. The range belongs to the panel
 *     rather than to the roster behind it: one account is on this axis, so the
 *     window that suits it has nothing to do with the window the grid is showing.
 *  3. **Tracked posts**, ranked by a chosen metric.
 *  4. **Everything else**, folded away — the extras the scraper returned free,
 *     which are a footnote, not a headline.
 *
 * A failed read is the exception to that order: it sits directly under the
 * header, because it is the only thing that explains why the chart below it has
 * a flat tail, and folding it away would leave stale numbers looking current.
 *
 * ── One account, one scale ──────────────────────────────────────────────────
 * The follower axis is scaled to the data rather than zero-based: these accounts
 * span 13k to 684k, and a zero-based axis flattens a good month into a straight
 * line. Only one account is on this axis, so the scale can simply be its own.
 */
export function AccountPanel({
  account,
  days,
  range,
  posts,
  postsLoading,
  onTrackPost,
  onSyncPost,
  onSetPostTracking,
  onDeletePost,
  onLoadFullPostHistory,
  onSetTrackPosts,
}: {
  account: GrowthAccount;
  days: DayMap;
  /** The roster's range, used only as this panel's starting window. */
  range: GrowthRange;
  /** Only this account's tracked posts — the page does the filtering. */
  posts: GrowthPost[];
  postsLoading: boolean;
  onTrackPost: (url: string) => Promise<void>;
  onSyncPost: (id: string) => Promise<{ refreshedAlongside: number }>;
  onSetPostTracking: (id: string, isActive: boolean) => Promise<void>;
  onDeletePost: (id: string) => Promise<void>;
  onLoadFullPostHistory: (id: string) => Promise<void>;
  onSetTrackPosts: (id: string, trackPosts: boolean) => Promise<TrackPostsResult>;
}) {
  const [panelRange, setPanelRange] = useState<GrowthRange>(range);
  const [metric, setMetric] = useState<TableMetric>('engagement');
  const [sort, setSort] = useState<PostSort>('top');
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const { busyId, setTrackPosts } = useTrackPosts(onSetTrackPosts);

  const from = useMemo(() => rangeStart(panelRange), [panelRange]);

  const view = useMemo(() => ({
    delta: deltaFor(days, from),
    rows: pointsFor(days, from, 'absolute').map((p) => ({ date: p.date, followers: p.value })),
    spike: account.isActive ? spikePercent(days) : null,
  }), [days, from, account.isActive]);

  const nextReading = useMemo(() => soonestRefresh(posts), [posts]);

  /**
   * The strips, and the scale their magnitude bars share.
   *
   * `best` is the largest measured value in *this* list, so the bar ranks the
   * account's own posts against each other — which is the only comparison that
   * means anything here. A post the scraper has never reported this metric for
   * gets `share: null` and no bar, rather than a zero-width one that would be
   * indistinguishable from a real zero.
   */
  const strips = useMemo(() => {
    const mapped = posts.map((post) => ({
      post,
      value: post.latest ? metricValue(post.latest, metric) : null,
      velocity: velocityFor(post.history, metric),
      spark: pointsForMetric(post.history, metric).map(
        (p): SeriesPoint => ({ date: p.t, value: p.value }),
      ),
    }));

    const best = mapped.reduce((max, r) => (r.value !== null && r.value > max ? r.value : max), 0);

    const sorted = [...mapped].sort((a, b) => {
      if (sort === 'new') {
        // An unplaced post sinks either way: it is missing from the timeline,
        // not the oldest thing in it.
        const at = a.post.postedAt ? Date.parse(a.post.postedAt) : null;
        const bt = b.post.postedAt ? Date.parse(b.post.postedAt) : null;
        if (at === null && bt === null) return 0;
        if (at === null) return 1;
        if (bt === null) return -1;
        return bt - at;
      }
      // Unmeasured rows sink too — "not reported" is not "worst performing".
      if (a.value === null && b.value === null) return 0;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value;
    });

    return sorted.map((r) => ({
      ...r,
      share: r.value === null || best <= 0 ? null : r.value / best,
    }));
  }, [posts, metric, sort]);

  // Read from the live array rather than held in state, so a sync updates the
  // open post in place instead of showing the copy captured when it opened. It
  // also self-heals: a deleted post resolves to null and the panel falls back to
  // the account level on its own.
  const openPost = useMemo(
    () => (openPostId === null ? null : posts.find((p) => p.id === openPostId) ?? null),
    [posts, openPostId],
  );

  /** Stable, so `PostStrip`'s `memo` is not defeated by a new callback each render. */
  const openPostDetail = useCallback((post: GrowthPost) => {
    setOpenPostId(post.id);
    // The detail opens on the trimmed series it already has; the untrimmed one
    // arrives a read later and replaces it.
    void onLoadFullPostHistory(post.id);
  }, [onLoadFullPostHistory]);

  const isX = account.platform === 'twitter';
  const readFailed = account.isActive && account.lastScrapeStatus === 'failed';
  const trackBusy = busyId === account.id;

  // ── Level two ────────────────────────────────────────────────────────────
  if (openPost) {
    return (
      <PostDetailBody
        post={openPost}
        onBack={() => setOpenPostId(null)}
        onAfterDelete={() => setOpenPostId(null)}
        onSync={onSyncPost}
        onSetTracking={onSetPostTracking}
        onDelete={onDeletePost}
      />
    );
  }

  // ── Level one ────────────────────────────────────────────────────────────
  return (
    <>
      <SheetHeader className="gap-3">
        <div className="flex items-start gap-3 pr-8">
          <AccountAvatar account={account} className="size-11 rounded-xl" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-lg">@{account.handle}</SheetTitle>
            <SheetDescription asChild>
              <a
                href={account.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 text-sm text-zinc-400 underline-offset-2 transition-colors hover:text-white hover:underline"
              >
                View on {PLATFORM_LABEL[account.platform]}
                <ExternalLinkIcon className="size-3" aria-hidden />
              </a>
            </SheetDescription>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PlatformChip platform={account.platform} />
          <CategoryDot category={account.category} />
          {!account.isActive && (
            <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
              Not tracked
            </span>
          )}
          {readFailed && <ScrapeFailedBadge error={account.lastScrapeError} />}
          {view.spike !== null && view.spike > 0 && <SpikeBadge percent={view.spike} />}
        </div>
      </SheetHeader>

      <div className="space-y-5 px-4 pb-6">
        {/* The only place a reader learns *why* an account stopped reporting.
            The chart below just shows a flat tail. */}
        {account.lastScrapeStatus === 'failed' && account.lastScrapeError && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {account.lastScrapeError}
          </p>
        )}

        {/* ── 1. Controls ──────────────────────────────────────────────────
            First, because they are the only decisions on this panel and both of
            them are a line on the bill. The reference this layout came from put
            a "check every 15 min / 1 hour / 1 day" picker here; there is no such
            control to expose — a post's cadence is set by its own age, because
            engagement can only be read as its value right now. */}
        {isX ? (
          <section className="space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel>Controls</SectionLabel>
              {/* Not a <label>: Radix renders a `role="switch"` button, which is
                  not a labelable element, so a wrapping label names nothing and
                  its text does not toggle. `aria-labelledby` is what actually
                  gives the control its name — the manage table reaches the same
                  place with `aria-label`. */}
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                {/* `htmlFor` would not toggle a button either, so the text
                    carries its own handler — the visible label stays clickable,
                    which is the only part of a <label> worth keeping here. It is
                    not focusable: the switch beside it already is, and a second
                    tab stop for one control is noise. */}
                <span
                  id="account-track-posts-label"
                  onClick={() => {
                    if (trackBusy || !account.isActive) return;
                    void setTrackPosts(account, !account.trackPosts);
                  }}
                  className={account.isActive && !trackBusy ? 'cursor-pointer' : undefined}
                >
                  Find new posts automatically
                </span>
                <Switch
                  aria-labelledby="account-track-posts-label"
                  checked={account.trackPosts}
                  disabled={trackBusy || !account.isActive}
                  onCheckedChange={(next) => { void setTrackPosts(account, next); }}
                />
              </div>
            </div>

            <TrackPostBar onTrack={onTrackPost} disabled={postsLoading} />
            <p className="text-[11px] text-zinc-400">
              A post is filed under whoever wrote it, so a link from another account appears on
              that account’s panel rather than here.
            </p>

            {account.trackPosts && account.postsWindowSaturated && (
              <p role="status" className="rounded-lg bg-orange-500/10 px-3 py-2 text-sm text-orange-400">
                This account posts faster than one nightly read can see, so some posts are being
                missed. Paste the ones that matter above.
              </p>
            )}
          </section>
        ) : (
          // One sentence gets no box around it (DESIGN.md §6).
          <p className="text-sm text-zinc-400">
            Post tracking is available for X accounts only.
          </p>
        )}

        {/* ── 2. Followers ─────────────────────────────────────────────── */}
        <section>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>Followers</SectionLabel>
            <ToggleGroup
              type="single"
              value={panelRange}
              onValueChange={(v) => v && setPanelRange(v as GrowthRange)}
              variant="outline"
              size="sm"
              aria-label="Date range"
            >
              {(Object.keys(RANGE_DAYS) as GrowthRange[]).map((r) => (
                <ToggleGroupItem key={r} value={r} className={SEGMENT_ITEM_CLASS}>
                  {r === 'all' ? 'All' : r}
                  <span className="sr-only"> — {RANGE_LABEL[r]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-wrap items-baseline gap-2.5">
            <p className="text-2xl font-semibold tabular-nums">
              {view.delta.last === null ? '—' : formatCount(view.delta.last)}
            </p>
            <DeltaValue delta={view.delta} className="text-sm font-medium" />
            <span className="text-[11px] text-zinc-400">
              {RANGE_LABEL[panelRange].toLowerCase()}
            </span>
          </div>

          {view.rows.length >= 2 ? (
            <ChartContainer config={chartConfig} className="mt-3 h-[180px] w-full">
              <AreaChart data={view.rows} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.12} />
                <XAxis
                  dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32}
                  tickFormatter={(v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', timeZone: 'UTC',
                  })}
                />
                <YAxis
                  tickLine={false} axisLine={false} tickMargin={8} width={44}
                  domain={['dataMin - 200', 'dataMax + 200']}
                  tickFormatter={(v: number) => formatCompact(v)}
                />
                <ChartTooltip
                  content={<ChartTooltipContent
                    labelFormatter={(l) => new Date(`${String(l)}T00:00:00Z`).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
                    })}
                    formatter={(value) => [` ${formatCount(Number(value))}`, 'Followers']}
                  />}
                />
                <Area
                  dataKey="followers" type="monotone" connectNulls
                  stroke="var(--color-followers)" fill="var(--color-followers)"
                  fillOpacity={0.15} strokeWidth={2} isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">
              {view.rows.length === 1
                ? 'One reading in this window. The next comes with tonight’s scrape.'
                : 'No readings in this range.'}
            </p>
          )}
        </section>

        {/* ── 3. Tracked posts ─────────────────────────────────────────── */}
        {isX && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionLabel>
                Tracked posts
                {posts.length > 0 && (
                  <span className="ml-1.5 font-normal tabular-nums text-zinc-500">
                    {posts.length}
                  </span>
                )}
              </SectionLabel>
              {posts.length > 0 && (
                <p className="flex items-baseline gap-1.5 text-[11px] text-zinc-400">
                  Next refresh
                  <span className="font-medium text-white">
                    {nextReading === null
                      ? <span className="font-normal text-zinc-400">not scheduled</span>
                      : <RefreshCountdown to={nextReading} prefix="in " />}
                  </span>
                </p>
              )}
            </div>

            {posts.length > 0 && (
              <>
                {/* One choice, three places — the figure, the rate and the bar
                    behind every strip all describe the selected metric, rather
                    than eight columns of numbers nobody can scan. */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ToggleGroup
                    type="single"
                    value={metric}
                    onValueChange={(v) => v && setMetric(v as TableMetric)}
                    variant="outline"
                    size="sm"
                    aria-label="Metric shown"
                  >
                    {PANEL_METRICS.map((m) => (
                      <ToggleGroupItem key={m} value={m} className={SEGMENT_ITEM_CLASS}>
                        {METRIC_CHIP[m]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {/* What the table's sortable headers did, at panel width. Two
                      orders are the two questions anyone asks of this list —
                      "what worked" and "what is happening now". */}
                  <ToggleGroup
                    type="single"
                    value={sort}
                    onValueChange={(v) => v && setSort(v as PostSort)}
                    variant="outline"
                    size="sm"
                    aria-label="Order"
                  >
                    <ToggleGroupItem value="top" className={SEGMENT_ITEM_CLASS}>Top</ToggleGroupItem>
                    <ToggleGroupItem value="new" className={SEGMENT_ITEM_CLASS}>Newest</ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <ul className="space-y-1.5">
                  {strips.map(({ post, value, velocity, spark, share }) => (
                    <li key={post.id}>
                      <PostStrip
                        post={post}
                        metric={metric}
                        value={value}
                        velocity={velocity}
                        spark={spark}
                        share={share}
                        onOpen={openPostDetail}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}

            {posts.length === 0 && !postsLoading && (
              <p className="text-sm text-zinc-400">
                No posts from @{account.handle} are tracked yet. Paste a link above, or switch on
                automatic discovery to pick up its newest posts each night.
              </p>
            )}
          </section>
        )}

        {/* ── 4. The footnotes ─────────────────────────────────────────── */}
        <AccountFacts account={account} />
      </div>
    </>
  );
}

/**
 * The panel's section rhythm. An eyebrow rather than a heading: at this width
 * four `text-lg` headings would out-shout the figures they introduce, and the
 * thing a reader needs from them is only "a new section starts here".
 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400">
      {children}
    </h2>
  );
}

/**
 * Everything that is true but not why anyone opened the panel — folded away, and
 * closed by default, because an account's category and its scraper extras are a
 * footnote to its follower line rather than a competitor for it.
 */
function AccountFacts({ account }: { account: GrowthAccount }) {
  const snapshot = account.latest;
  const extras: Array<[string, number | undefined]> = account.platform === 'facebook'
    ? snapshot
      ? [['Page likes', snapshot.likes], ['Rating', snapshot.rating], ['Reviews', snapshot.ratingCount]]
      : []
    : snapshot
      ? [['Following', snapshot.following], ['Posts', snapshot.posts], ['Media', snapshot.media]]
      : [];
  const present = extras.filter((f): f is [string, number] => f[1] !== undefined);

  return (
    <details className="group border-t border-white/[0.07] pt-4">
      <summary className="cursor-pointer list-none text-sm font-medium text-zinc-300 transition-colors hover:text-white">
        Account details
        <span className="ml-2 text-[11px] font-normal text-zinc-400">
          category, platform{present.length > 0 && ', what else was captured'}
        </span>
      </summary>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="Category">{account.category ?? 'Unfiled'}</Fact>
        <Fact label="Platform">{PLATFORM_LABEL[account.platform]}</Fact>
        <Fact label="Tracking">{account.isActive ? 'Read nightly' : 'Stopped'}</Fact>
        {/* Shown as a latest value only, never charted: these are not in the
            imported history, so a chart of them would start abruptly at whenever
            automation began and imply the metric did not exist before. */}
        {present.map(([label, value]) => (
          <Fact key={label} label={label}>
            {label === 'Rating' ? value.toFixed(1) : formatCount(value)}
          </Fact>
        ))}
      </dl>

      {snapshot && (
        <p className="mt-3 text-[11px] text-zinc-400">
          Last reading {new Date(`${snapshot.date}T00:00:00Z`).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
          })}
        </p>
      )}
    </details>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums text-zinc-200">{children}</dd>
    </div>
  );
}
