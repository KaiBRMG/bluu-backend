'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeftIcon, ExternalLinkIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import {
  AccountAvatar, CategoryDot, DeltaValue, PlatformChip, SEGMENT_ITEM_CLASS, SpikeBadge,
} from './growthUi';
import { RefreshCountdown } from './postUi';
import { TrackPostBar } from './TrackPostBar';
import { PostsTable, type TableMetric } from './PostsTable';
import { useTrackPosts } from './useTrackPosts';
import {
  RANGE_LABEL, deltaFor, formatCompact, formatCount, pointsFor,
  type DayMap, type GrowthRange,
} from '@/lib/growth/metrics';
import { spikePercent } from '@/lib/growth/signals';
import { METRIC_LABEL, soonestRefresh } from '@/lib/growth/postMetrics';
import { PLATFORM_LABEL } from '@/lib/growth/platform';
import type { TrackPostsResult } from '@/hooks/useGrowthTracking';
import type { GrowthAccount, GrowthPost, GrowthSnapshot } from '@/types/firestore';

/**
 * Mounted only after a post has been opened, and dynamically imported — the
 * sheet carries its own recharts chart on top of this view's. The latch keeps
 * the close animation; unmounting on close would make it vanish.
 */
const PostDetailSheet = dynamic(
  () => import('./PostDetailSheet').then((m) => m.PostDetailSheet),
  { ssr: false },
);

const chartConfig = { followers: { label: 'Followers', color: '#3b82f6' } } satisfies ChartConfig;

const TABLE_METRICS: TableMetric[] = ['engagement', 'likes', 'reposts', 'replies', 'views'];

/**
 * One account, in full — a page, not a sheet.
 *
 * ── Why it replaced a side sheet ────────────────────────────────────────────
 * The sheet was sized for three facts and a chart. This view is where an
 * account's *posts* now live, and a table of tracked posts with its own controls
 * does not fit in a 512px panel with the roster still showing behind it. A
 * detail this substantial is a place you go, not a thing you peek at — so it
 * takes the whole width, opens with a back control, and leaves the overview
 * mounted in the page's state so returning is instant and costs no refetch.
 *
 * ── One account, one scale ──────────────────────────────────────────────────
 * The follower axis is scaled to the data rather than zero-based, for the reason
 * this whole subsystem exists to work around: these accounts span 13k to 684k,
 * and a zero-based axis flattens a good month into a straight line. Here there
 * is only one account on the axis, so the scale can simply be its own.
 */
export function AccountDetail({
  account,
  days,
  from,
  range,
  posts,
  postsLoading,
  onBack,
  onTrackPost,
  onSyncPost,
  onSetPostTracking,
  onDeletePost,
  onLoadFullPostHistory,
  onSetTrackPosts,
}: {
  account: GrowthAccount;
  days: DayMap;
  from: string | null;
  range: GrowthRange;
  /** Only this account's tracked posts — the page does the filtering. */
  posts: GrowthPost[];
  postsLoading: boolean;
  onBack: () => void;
  onTrackPost: (url: string) => Promise<void>;
  onSyncPost: (id: string) => Promise<{ refreshedAlongside: number }>;
  onSetPostTracking: (id: string, isActive: boolean) => Promise<void>;
  onDeletePost: (id: string) => Promise<void>;
  onLoadFullPostHistory: (id: string) => Promise<void>;
  onSetTrackPosts: (id: string, trackPosts: boolean) => Promise<TrackPostsResult>;
}) {
  const [metric, setMetric] = useState<TableMetric>('engagement');
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [everOpenedPost, setEverOpenedPost] = useState(false);
  const { busyId, setTrackPosts } = useTrackPosts(onSetTrackPosts);

  const view = useMemo(() => ({
    delta: deltaFor(days, from),
    rows: pointsFor(days, from, 'absolute').map((p) => ({ date: p.date, followers: p.value })),
    spike: spikePercent(days),
  }), [days, from]);

  const nextReading = useMemo(() => soonestRefresh(posts), [posts]);

  // Read from the live array rather than held in state, so a sync updates the
  // open sheet in place instead of showing the copy captured when it opened.
  const openPost = useMemo(
    () => (openPostId === null ? null : posts.find((p) => p.id === openPostId) ?? null),
    [posts, openPostId],
  );

  /** Stable, so `PostRow`'s `memo` survives a hover — the highlight lives here. */
  const openPostDetail = useCallback((post: GrowthPost) => {
    setOpenPostId(post.id);
    setEverOpenedPost(true);
    // The sheet opens on the trimmed series it already has; the untrimmed one
    // arrives a read later and replaces it.
    void onLoadFullPostHistory(post.id);
  }, [onLoadFullPostHistory]);

  const isX = account.platform === 'twitter';

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 h-8 text-zinc-400">
        <ArrowLeftIcon className="size-4" aria-hidden />
        Back to overview
      </Button>

      <header className="flex flex-wrap items-center gap-4">
        <AccountAvatar account={account} className="size-13 rounded-xl" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight outline-none">@{account.handle}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <CategoryDot category={account.category} />
            <span aria-hidden className="text-zinc-400">·</span>
            <PlatformChip platform={account.platform} />
            {!account.isActive && (
              <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
                Not tracked
              </span>
            )}
            <a
              href={account.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-zinc-400 underline-offset-2 transition-colors hover:text-white hover:underline"
            >
              View on {PLATFORM_LABEL[account.platform]}
              <ExternalLinkIcon className="size-3" aria-hidden />
            </a>
          </div>
        </div>
        {view.spike !== null && view.spike > 0 && (
          <div className="ms-auto">
            <SpikeBadge percent={view.spike} />
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-xs text-zinc-400">
              Followers · {RANGE_LABEL[range].toLowerCase()}
            </h2>
            <DeltaValue delta={view.delta} className="text-sm font-medium" />
          </div>
          <p className="mb-3 text-2xl font-semibold tabular-nums">
            {view.delta.last === null ? '—' : formatCount(view.delta.last)}
          </p>

          {view.rows.length >= 2 ? (
            <ChartContainer config={chartConfig} className="h-[220px] w-full">
              <AreaChart data={view.rows} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.12} />
                <XAxis
                  dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32}
                  tickFormatter={(v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', timeZone: 'UTC',
                  })}
                />
                <YAxis
                  tickLine={false} axisLine={false} tickMargin={8} width={48}
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
            <p className="text-sm text-zinc-400">
              {view.rows.length === 1
                ? 'One reading so far. The next comes with tonight’s scrape.'
                : 'No readings in this range.'}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-5">
          <Fact label="Category">{account.category ?? 'Unfiled'}</Fact>
          <Fact label="Platform">{PLATFORM_LABEL[account.platform]}</Fact>
          <Fact label="Tracked posts">
            {!isX
              ? 'X only'
              : posts.length === 0
                ? 'None yet'
                : `${posts.length} post${posts.length === 1 ? '' : 's'}`}
          </Fact>

          <ExtraMetrics platform={account.platform} snapshot={account.latest} />

          {/* The only place a reader learns *why* an account stopped reporting.
              The chart above just shows a flat tail. */}
          {account.lastScrapeStatus === 'failed' && account.lastScrapeError && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {account.lastScrapeError}
            </p>
          )}
        </section>
      </div>

      {isX && (
        <section className="space-y-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Post tracking</h2>
            {/* The reference this layout came from put a "check every 15 min /
                1 hour / 1 day" picker here. There is no such control to expose:
                a post's cadence is set by its own age (6h for a day, then 12h,
                then daily, then weekly, frozen at 30 days) because engagement can
                only be read as its value right now. What belongs in this slot is
                the one thing that *is* a choice — whether this account's new
                posts get picked up at all, which is a separate line on the bill. */}
            {/* Not a <label>: Radix renders a `role="switch"` button, which is
                not a labelable element, so a wrapping label names nothing and
                its text does not toggle. `aria-labelledby` is what actually
                gives the control its name — the manage table reaches the same
                place with `aria-label`. */}
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Switch
                aria-labelledby="account-track-posts-label"
                checked={account.trackPosts}
                disabled={busyId === account.id || !account.isActive}
                onCheckedChange={(next) => { void setTrackPosts(account, next); }}
              />
              {/* `htmlFor` would not toggle a button either, so the text
                  carries its own handler — the visible label stays clickable,
                  which is the only part of a <label> worth keeping here. It is
                  not focusable: the switch beside it already is, and a second
                  tab stop for one control is noise. */}
              <span
                id="account-track-posts-label"
                onClick={() => {
                  if (busyId === account.id || !account.isActive) return;
                  void setTrackPosts(account, !account.trackPosts);
                }}
                className={account.isActive && busyId !== account.id ? 'cursor-pointer' : undefined}
              >
                Find new posts automatically
              </span>
            </div>
          </div>

          <TrackPostBar onTrack={onTrackPost} disabled={postsLoading} />
          <p className="text-[11px] text-zinc-400">
            A post is filed under whoever wrote it, so a link from another account appears on that
            account’s page rather than here.
          </p>

          {account.trackPosts && account.postsWindowSaturated && (
            <p role="status" className="rounded-lg bg-orange-500/10 px-3 py-2 text-sm text-orange-400">
              This account posts faster than one nightly read can see, so some posts are being
              missed. Paste the ones that matter above.
            </p>
          )}

          {posts.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-baseline gap-2 text-sm">
                  <span className="text-[11px] text-zinc-400">Next refresh</span>
                  <span className="font-medium text-white">
                    {nextReading === null
                      ? <span className="text-zinc-400">nothing scheduled</span>
                      : <RefreshCountdown to={nextReading} prefix="in " />}
                  </span>
                </p>
                {/* One choice, three columns — the number, the rate and the
                    sparkline all describe the selected metric, rather than eight
                    columns of figures nobody can scan. */}
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

              <PostsTable
                posts={posts}
                metric={metric}
                metricLabel={metric === 'engagement' ? 'Engagement' : METRIC_LABEL[metric]}
                highlightId={highlightId}
                onHighlight={setHighlightId}
                onOpen={openPostDetail}
              />
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

      {everOpenedPost && (
        <PostDetailSheet
          post={openPost}
          onOpenChange={(open) => { if (!open) setOpenPostId(null); }}
          onSync={onSyncPost}
          onSetTracking={onSetPostTracking}
          onDelete={onDeletePost}
        />
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{children}</p>
    </div>
  );
}

/**
 * The fields each actor returns alongside followers at no extra cost. Shown as a
 * latest value only, never charted: they are not in the imported history, so a
 * chart of them would start abruptly at whenever automation began and imply the
 * metric did not exist before.
 */
function ExtraMetrics({
  platform,
  snapshot,
}: {
  platform: GrowthAccount['platform'];
  snapshot: (GrowthSnapshot & { date: string }) | null;
}) {
  if (!snapshot) return null;

  const fields: Array<[string, number | undefined]> = platform === 'facebook'
    ? [['Page likes', snapshot.likes], ['Rating', snapshot.rating], ['Reviews', snapshot.ratingCount]]
    : [['Following', snapshot.following], ['Posts', snapshot.posts], ['Media', snapshot.media]];

  const present = fields.filter((f): f is [string, number] => f[1] !== undefined);
  if (present.length === 0) return null;

  return (
    <div className="border-t border-white/[0.07] pt-4">
      <h3 className="mb-2 text-xs text-zinc-400">Also captured</h3>
      <dl className="grid grid-cols-3 gap-3">
        {present.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-zinc-400">{label}</dt>
            <dd className="text-sm tabular-nums text-zinc-300">
              {label === 'Rating' ? value.toFixed(1) : formatCount(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-zinc-400">
        As of {new Date(`${snapshot.date}T00:00:00Z`).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
        })}
      </p>
    </div>
  );
}
