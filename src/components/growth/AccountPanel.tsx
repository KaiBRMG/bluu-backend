'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CircleSlashIcon, ExternalLinkIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Accordion } from '@/components/ui/accordion';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import {
  AccountAvatar, CategorySelect, DeltaValue, PlatformChip, SEGMENT_ITEM_CLASS,
  ScrapeFailedBadge, SpikeBadge,
} from './growthUi';
import { RefreshCountdown, useSlowTick } from './postUi';
import { Button } from '@/components/ui/button';
import { TrackPostBar } from './TrackPostBar';
import { PostCard, STRIP_METRICS, type PostCardFigures } from './PostCard';
import { useTrackPosts } from './useTrackPosts';
import {
  MANUAL_REFRESH_COOLDOWN_MS, RANGE_DAYS, RANGE_LABEL, deltaFor, formatCompact, formatCount,
  pointsFor, rangeStart,
  type DayMap, type GrowthRange, type SeriesPoint,
} from '@/lib/growth/metrics';
import { spikePercent } from '@/lib/growth/signals';
import {
  formatAge, metricValue, postDeltaFor, ratePointsFor, soonestRefresh, totalEngagement,
  velocityFor,
  type PostMetric,
} from '@/lib/growth/postMetrics';
import { PLATFORM_LABEL } from '@/lib/growth/platform';
import type { GrowthCategory } from '@/lib/growth/category';
import type { RefreshAccountResult, TrackPostsResult } from '@/hooks/useGrowthTracking';
import type { GrowthAccount, GrowthPost } from '@/types/firestore';

const chartConfig = { followers: { label: 'Followers', color: '#3b82f6' } } satisfies ChartConfig;

/**
 * One account, inside the panel — and the panel's first of two levels.
 *
 * ── Why it went back to being a sheet ───────────────────────────────────────
 * It was a full-width page for one reason: `PostsTable`, five columns and three
 * sortable headers, does not fit in a panel. Replacing that table with a column
 * of [`PostCard`](./PostCard.tsx)s removes the reason — and the cards are
 * `AccountCard` one level down, so the roster behind the panel and the list
 * inside it are read with the same eye movement. What is bought back is the
 * thing a full-page detail costs and cannot give back: the roster stays on
 * screen, so opening an account is a peek rather than a departure, and moving
 * between accounts does not bounce through an overview you just left.
 *
 * ── One panel, no second level ──────────────────────────────────────────────
 * A post's detail opens **inside its own card**, not in a panel over this one.
 * The list is the context for every number in it; a detail that replaced the
 * list made comparing two posts a round trip with nothing on screen in between.
 * `Accordion type="single"` keeps one open at a time, so the panel never becomes
 * a page of stacked detail.
 *
 * ── Order of the contents is an argument about priority ─────────────────────
 * Controls first, then the number, then the posts, then the facts:
 *
 *  1. **Controls.** The two things that cost money and change what the system
 *     does — post discovery, and pasting a link to track. They were at the very
 *     bottom of the page version, below a table, which put the page's only
 *     decisions behind its longest read.
 *  2. **Followers** — where the account stands, what it did over the window, and
 *     the shape of it.
 *  3. **Tracked posts**, newest first, each card answering the same three
 *     questions about a post. The order is the timeline, not the leaderboard:
 *     engagement is cumulative, so ranking by it puts the oldest posts
 *     permanently on top and buries the ones still moving — which are the only
 *     ones a refresh can still change.
 *  4. **Everything else**, folded away — the extras the scraper returned free,
 *     which are a footnote, not a headline.
 *
 * A failed read is the exception to that order: it sits directly under the
 * header, because it is the only thing that explains why the chart below it has
 * a flat tail, and folding it away would leave stale numbers looking current.
 *
 * ── One window, one meaning, for everything on the panel ────────────────────
 * The **Window** control lives in the header rather than beside the chart,
 * because it is not the chart's control: it scopes the follower delta and chart
 * *and* every post card's change figure and sparkline. One picker that means the
 * same thing wherever its effect lands is the whole reason it sits above all of
 * it. It seeds from the roster's range and diverges freely; nothing is written
 * back, because one account's useful window has nothing to do with the grid's.
 *
 * What it does **not** do is decide which posts are listed. It briefly did, and
 * that made it look broken: under a 7-day window every listed post was at most
 * seven days old, so "change over 7 days" was just its lifetime total. Scoping
 * only the measurement is what makes the control do visible work.
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
  onSetTracking,
  onSetCategory,
  onRefreshAccount,
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
  /** Stop or resume the account. Resolves with how many posts stopped with it. */
  onSetTracking: (id: string, isActive: boolean) => Promise<number>;
  onSetCategory: (id: string, category: GrowthCategory | null) => Promise<void>;
  /** Buys one reading now — followers and this account's posts, two bills. */
  onRefreshAccount: (id: string) => Promise<RefreshAccountResult>;
}) {
  const [panelRange, setPanelRange] = useState<GrowthRange>(range);
  const [openPostId, setOpenPostId] = useState<string>('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const { busyId, setTrackPosts } = useTrackPosts(onSetTrackPosts);

  /**
   * Re-file the account. Optimism is safe here and nowhere else on this panel:
   * a category is a label with no history consequences, the hook patches the
   * row in place, and a failure is reported rather than swallowed.
   */
  const setCategory = useCallback(async (next: GrowthCategory | null) => {
    setCategoryBusy(true);
    try {
      await onSetCategory(account.id, next);
      toast.success(next
        ? `@${account.handle} is now filed under ${next}`
        : `@${account.handle} is now unfiled`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change that category.');
    } finally {
      setCategoryBusy(false);
    }
  }, [account.id, account.handle, onSetCategory]);

  const from = useMemo(() => rangeStart(panelRange), [panelRange]);

  const view = useMemo(() => ({
    delta: deltaFor(days, from),
    rows: pointsFor(days, from, 'absolute').map((p) => ({ date: p.date, followers: p.value })),
    spike: account.isActive ? spikePercent(days) : null,
  }), [days, from, account.isActive]);

  const nextReading = useMemo(() => soonestRefresh(posts), [posts]);

  /** "over 7 days" / "all time" — one phrasing, reused by every figure below. */
  const windowLabel = panelRange === 'all' ? 'all time' : `over ${RANGE_LABEL[panelRange]}`;

  /**
   * The cards, newest first, every figure on them scoped to the window.
   *
   * ── The window measures; it does not filter membership ────────────────────
   * It briefly did both — the list was also cut to posts *published* inside the
   * window — and that made the control look broken: under a 7-day window every
   * listed post was at most seven days old, so "change over 7 days" was simply
   * its lifetime total and the picker appeared to do nothing. Scoping only the
   * measurement makes the control mean one thing on the whole panel, exactly as
   * the follower section reads it: the roster is always whole, and the window
   * says *how much each thing moved lately*.
   *
   * ── The order is fixed, and nothing re-sorts it ───────────────────────────
   * Ranking by engagement is the obvious move and it is wrong here: engagement
   * is cumulative, so the top of that list is simply the oldest posts,
   * permanently, while the ones still accumulating — the only ones the next
   * refresh can change — sink out of sight. The timeline is also the order the
   * reader already holds in their head. A post with no publish time sinks either
   * way: it is missing from the timeline, not the oldest thing in it.
   */
  const cards = useMemo(() => posts
    .map((post) => ({
      post,
      figures: {
        // Absolute, latest — what X states under the post. Unscoped on purpose:
        // "where this post stands" is not a windowed question, which is also why
        // it stays readable on a frozen post no window can measure. Only the
        // five the strip renders: `quotes` was built here for every card and
        // never read, because the open card recomputes its own rows.
        totals: Object.fromEntries(
          STRIP_METRICS.map((m) => [m, post.latest ? metricValue(post.latest, m) : null]),
        ) as Partial<Record<PostMetric, number | null>>,
        engagement: post.latest ? totalEngagement(post.latest) : null,
        delta: postDeltaFor(post.history, 'engagement', from),
        // The rate, not the running total — see `ratePointsFor` for why a
        // cumulative trace is the same shape on every post that ever worked.
        rateSpark: ratePointsFor(post.history, 'engagement', from).map(
          (p): SeriesPoint => ({ date: p.t, value: p.value }),
        ),
        velocity: velocityFor(post.history, 'engagement'),
      } satisfies PostCardFigures,
    }))
    .sort((a, b) => {
      const at = a.post.postedAt ? Date.parse(a.post.postedAt) : null;
      const bt = b.post.postedAt ? Date.parse(b.post.postedAt) : null;
      if (at === null && bt === null) return 0;
      if (at === null) return 1;
      if (bt === null) return -1;
      return bt - at;
    }), [posts, from]);

  /**
   * Opening a card fetches its untrimmed history — the card renders on the
   * trimmed series it already has, and the full one replaces it a read later.
   * `''` is Radix's "nothing open"; a `collapsible` single accordion reports a
   * close as the empty string.
   */
  const openPostDetail = useCallback((id: string) => {
    setOpenPostId(id);
    if (id) void onLoadFullPostHistory(id);
  }, [onLoadFullPostHistory]);

  /** What stopping would actually switch off — the confirm has to name it. */
  const activePosts = useMemo(() => posts.filter((p) => p.isActive).length, [posts]);

  const isX = account.platform === 'twitter';
  const readFailed = account.isActive && account.lastScrapeStatus === 'failed';
  const trackBusy = busyId === account.id;

  return (
    <>
      {/* `shrink-0` against the body's `flex-1` below: the header is a fixed
          band and the body is the only thing that scrolls, which is what keeps
          the Window control and the sheet's close button reachable from the
          bottom of a twenty-post list. */}
      <SheetHeader className="shrink-0 gap-3 border-b border-white/[0.07]">
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

        {/* What this account *is* on the left, what can be done to it on the
            right. The two things that belong here rather than in the deck below
            are the two that are true of the account itself rather than of what
            the panel is showing: its filing, and whether it is read at all.

            The category was a read-only dot. Making it the picker rather than
            adding one beside it keeps one element for one fact — and this is the
            only place the account's category colour appears on the panel, which
            is why this call site is the one that puts the mark in the trigger. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <PlatformChip platform={account.platform} />
            <CategorySelect
              dot
              className="h-6! w-auto gap-1.5 border-white/[0.07] bg-white/[0.04] px-2 py-0 text-[11px] font-medium"
              account={account}
              busy={categoryBusy}
              onChange={setCategory}
            />
            {readFailed && <ScrapeFailedBadge error={account.lastScrapeError} />}
            {view.spike !== null && view.spike > 0 && <SpikeBadge percent={view.spike} />}
          </div>
          <TrackingButton
            account={account}
            activePosts={activePosts}
            onSetTracking={onSetTracking}
          />
        </div>

        {/* The window belongs to the whole panel, not to the chart, so it sits
            above everything it scopes — the follower series *and* which posts are
            listed. Left inside the Followers section it silently changed the list
            further down, which is the failure the roster's own control layout
            already avoids. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
          {/* The plain label step. This names a control rather than heading a
              section, so it stays a <span> — the rail is for sections. */}
          <span id="account-window-label" className="text-xs font-medium text-zinc-400">
            Window
          </span>
          <ToggleGroup
            type="single"
            value={panelRange}
            onValueChange={(v) => v && setPanelRange(v as GrowthRange)}
            variant="outline"
            size="sm"
            aria-labelledby="account-window-label"
          >
            {(Object.keys(RANGE_DAYS) as GrowthRange[]).map((r) => (
              <ToggleGroupItem key={r} value={r} className={SEGMENT_ITEM_CLASS}>
                {r === 'all' ? 'All' : r}
                <span className="sr-only"> — {RANGE_LABEL[r]}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </SheetHeader>

      {/* `min-h-0` is load-bearing: a flex child's default `min-height: auto`
          refuses to shrink below its content, so without it this box grows to
          its full height and the panel scrolls as a whole again. */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-4 pb-6">
        {/* The only place a reader learns *why* an account stopped reporting.
            The chart below just shows a flat tail. */}
        {account.lastScrapeStatus === 'failed' && account.lastScrapeError && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {account.lastScrapeError}
          </p>
        )}

        {/* ── 1. The live line ─────────────────────────────────────────────
            How current this panel is, and the one control that changes the
            answer — the same construction the post card uses one level down,
            because it answers the same question about a bigger object. It sits
            above the Controls deck rather than inside it for a reason that is
            not cosmetic: the deck is X-only (post tracking is a capability
            Facebook does not have here), and a Facebook page still has
            followers worth refreshing. One placement, every platform. */}
        <AccountRefreshLine
          account={account}
          trackedPosts={isX ? posts.length : 0}
          onRefresh={onRefreshAccount}
        />

        {/* ── 2. Controls ──────────────────────────────────────────────────
            First, because they are the only decisions on this panel and both of
            them are a line on the bill. The reference this layout came from put
            a "check every 15 min / 1 hour / 1 day" picker here; there is no such
            control to expose — a post's cadence is set by its own age, because
            engagement can only be read as its value right now. */}
        {isX ? (
          <section className="space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <SectionLabel
              // Not a <label>: Radix renders a `role="switch"` button, which is
              // not a labelable element, so a wrapping label names nothing and
              // its text does not toggle. `aria-labelledby` is what actually
              // gives the control its name — the manage table reaches the same
              // place with `aria-label`.
              aside={(
                <div className="flex shrink-0 items-center gap-2 text-sm text-zinc-400">
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
              )}
            >
              Controls
            </SectionLabel>

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

        {/* ── 3. Followers ─────────────────────────────────────────────── */}
        <section>
          <SectionLabel>Followers</SectionLabel>

          <div className="mt-2 flex flex-wrap items-baseline gap-2.5">
            <p className="text-2xl font-semibold tabular-nums">
              {view.delta.last === null ? '—' : formatCount(view.delta.last)}
            </p>
            <DeltaValue delta={view.delta} className="text-sm font-medium" />
            <span className="text-[11px] text-zinc-400">{windowLabel}</span>
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

        {/* ── 4. Tracked posts ─────────────────────────────────────────── */}
        {isX && (
          <section className="space-y-3">
            <SectionLabel
              aside={posts.length > 0 && (
                <p className="flex shrink-0 items-baseline gap-1.5 text-[11px] text-zinc-400">
                  Next refresh
                  <span className="font-medium text-white">
                    {nextReading === null
                      ? <span className="font-normal text-zinc-400">not scheduled</span>
                      : <RefreshCountdown to={nextReading} prefix="in " />}
                  </span>
                </p>
              )}
            >
              Tracked posts
              {posts.length > 0 && (
                <span className="ml-1.5 tabular-nums text-zinc-400">{posts.length}</span>
              )}
            </SectionLabel>

            {posts.length > 0 && (
              // No metric picker above this list. The five figures X states under
              // a post fit on one line of each card, so a control that hid four
              // of them to reveal one was a worse deal than simply showing all
              // five — and the movement it could not show is what the open card
              // is now for.
              <Accordion
                type="single"
                collapsible
                value={openPostId}
                onValueChange={openPostDetail}
                className="space-y-2"
              >
                {cards.map(({ post, figures }) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    figures={figures}
                    windowLabel={windowLabel}
                    from={from}
                    onSync={onSyncPost}
                    onSetTracking={onSetPostTracking}
                    onDelete={onDeletePost}
                  />
                ))}
              </Accordion>
            )}

            {posts.length === 0 && !postsLoading && (
              <p className="text-sm text-zinc-400">
                No posts from @{account.handle} are tracked yet. Paste a link above, or switch on
                automatic discovery to pick up its newest posts each night.
              </p>
            )}
          </section>
        )}

        {/* ── 5. The footnotes ─────────────────────────────────────────── */}
        <AccountFacts account={account} />
      </div>
    </>
  );
}

/**
 * Stop reading this account — or start again.
 *
 * ── Stopping is not deleting, and the confirm has to make that obvious ───────
 * The word "stop" next to a destructive-looking button reads as "remove", and a
 * user who believes that will not stop an account they should. So the dialog
 * states the three things that are actually true: the card leaves the overview,
 * the account is still in Manage accounts, and every reading is kept. The button
 * is `outline`, not `destructive`, for the same reason — nothing is destroyed.
 *
 * ── It names the posts because they go too ──────────────────────────────────
 * Stopping an account stops its posts (the server cascades it in one pass — see
 * the PATCH route). That is the whole point of stopping, since the posts are a
 * line on the same bill, but it is invisible from here unless the dialog counts
 * them. Resuming does not bring them back on: twenty posts resuming themselves
 * is twenty billed refreshes nobody asked for, so they come back one at a time
 * from the list below.
 *
 * ── Resuming needs no confirm ───────────────────────────────────────────────
 * It costs one nightly follower read and undoes nothing. A dialog in front of it
 * would be ceremony — and the panel would otherwise be a dead end, since
 * stopping from here leaves the reader looking at an account they cannot
 * restart without going to find another screen.
 */
function TrackingButton({
  account,
  activePosts,
  onSetTracking,
}: {
  account: GrowthAccount;
  /** How many of its posts stopping would switch off. */
  activePosts: number;
  onSetTracking: (id: string, isActive: boolean) => Promise<number>;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (isActive: boolean) => {
    setBusy(true);
    try {
      const postsStopped = await onSetTracking(account.id, isActive);
      toast.success(isActive
        ? `Tracking @${account.handle} again`
        : postsStopped > 0
          ? `Stopped tracking @${account.handle} and ${postsStopped} of its post${postsStopped === 1 ? '' : 's'}. All history is kept.`
          : `Stopped tracking @${account.handle}. Its history is kept.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update that account.');
    } finally {
      setBusy(false);
    }
  };

  if (!account.isActive) {
    return (
      <Button variant="outline" size="xs" disabled={busy} onClick={() => { void run(true); }}>
        {busy
          ? <Loader2Icon className="activity-spinner size-3.5 animate-spin" aria-hidden />
          : <RefreshCwIcon className="size-3.5" aria-hidden />}
        Resume tracking
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="xs" disabled={busy}>
          {busy
            ? <Loader2Icon className="activity-spinner size-3.5 animate-spin" aria-hidden />
            : <CircleSlashIcon className="size-3.5" aria-hidden />}
          Stop tracking
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop tracking @{account.handle}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-zinc-400">
              <p>
                Nothing more is read or billed for this account. Its card leaves the
                overview{activePosts > 0 && (
                  <>
                    {' '}and {activePosts} tracked post{activePosts === 1 ? '' : 's'} stop
                    refreshing
                  </>
                )}.
              </p>
              <p>
                Every follower reading and every post’s history is kept, and the account
                stays in <span className="text-zinc-300">Manage accounts</span>, where it can
                be resumed.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep tracking</AlertDialogCancel>
          <AlertDialogAction onClick={() => { void run(false); }}>
            Stop tracking
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * How current this panel is, and the one control that changes the answer.
 *
 * ── It is the post card's live line, one level up ───────────────────────────
 * Same construction, same grouping, same reasoning: when the number was taken,
 * when the next one is due, and the control that buys one now — together,
 * because they answer one question ("how current is what I am looking at?") and
 * apart they are three unrelated facts scattered down a panel.
 *
 * ── The button spends on two bills, so it says so ───────────────────────────
 * One profile-actor run for followers **and** one tweet-actor run for this
 * account's posts. The discipline this whole feature runs on is that whoever
 * spends can see what they are spending: the meta line names both halves and
 * counts the posts, and the `title` carries the part that does not fit — that
 * the post read is padded to the actor's 20-result floor, so the posts that have
 * waited longest ride along at no extra cost.
 *
 * ── The cooldown here is an affordance, not the rule ────────────────────────
 * The server owns `lastManualRefreshAt` and 429s inside the window; this only
 * mirrors it so the button looks the way it will behave. It subscribes to the
 * slow tick so a panel left open re-enables itself, rather than reading "Wait
 * 14m" forever.
 */
function AccountRefreshLine({
  account,
  trackedPosts,
  onRefresh,
}: {
  account: GrowthAccount;
  /** How many of this account's posts a click would also read. */
  trackedPosts: number;
  onRefresh: (id: string) => Promise<RefreshAccountResult>;
}) {
  const [busy, setBusy] = useState(false);

  const tick = useSlowTick();
  const cooldownLeft = useMemo(() => {
    if (!account.lastManualRefreshAt) return 0;
    return MANUAL_REFRESH_COOLDOWN_MS - (Date.now() - Date.parse(account.lastManualRefreshAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is the clock
  }, [account.lastManualRefreshAt, tick]);
  const onCooldown = cooldownLeft > 0;

  const run = async () => {
    setBusy(true);
    try {
      const result = await onRefresh(account.id);

      // Reported as it happened, not as one cheerful line: the two halves are
      // two billed calls that fail independently, and a user who is told
      // "refreshed" when the post read died will not know to look again.
      const read: string[] = [];
      if (result.followersRead) read.push('followers');
      if (result.postsRead > 0) {
        read.push(`${result.postsRead} post${result.postsRead === 1 ? '' : 's'}`);
      }

      if (read.length === 0) {
        toast.warning(
          result.postsSkipped
            ?? `Nothing came back for @${account.handle}. Its existing history is unchanged.`,
        );
      } else {
        toast.success(`Read @${account.handle}'s ${read.join(' and ')}.`, {
          description: [
            result.postsSkipped,
            result.refreshedAlongside > 0
              && `${result.refreshedAlongside} other post${result.refreshedAlongside === 1 ? '' : 's'} were refreshed on the same call, at no extra cost.`,
          ].filter(Boolean).join(' ') || undefined,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not refresh @${account.handle}.`);
    } finally {
      setBusy(false);
    }
  };

  const willRead = trackedPosts > 0
    ? `followers and ${trackedPosts} tracked post${trackedPosts === 1 ? '' : 's'}`
    : 'followers';

  // Stopping an account is the instruction to stop spending on it — that is the
  // entire difference between stopping and deleting. A button that spent anyway
  // would quietly undo the one thing the user asked for.
  const stopped = !account.isActive;
  const waitMinutes = Math.ceil(cooldownLeft / 60_000);

  return (
    <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] text-zinc-400">
            Followers read {formatAge(account.lastScrapeAt)}
          </p>
          <p className="text-sm text-zinc-200">
            {stopped ? 'No scheduled reads' : <>Next scrape <NextScrape /></>}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={busy || onCooldown || stopped}
          title={stopped
            ? 'Tracking is stopped for this account, so nothing is being spent on it. Resume it from Manage accounts to read it again.'
            : onCooldown
              ? `Refreshed by hand recently. Available again in ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}.`
              : `Read this account's ${willRead} now. Both are billed; the post read is padded to the scraper's 20-result floor, so the posts that have waited longest ride along at no extra cost.`}
        >
          {busy
            ? <Loader2Icon className="activity-spinner size-3.5 animate-spin" aria-hidden />
            : <RefreshCwIcon className="size-3.5" aria-hidden />}
          {busy ? 'Reading…' : onCooldown ? `Wait ${waitMinutes}m` : 'Refresh now'}
        </Button>
      </div>

      {/* The price, on screen rather than in the tooltip. The discipline this
          feature runs on is that whoever spends can see what they are spending,
          and a tooltip reaches neither a keyboard nor a glance. */}
      <p className="mt-2 text-[11px] text-zinc-400">
        {stopped
          ? 'Tracking is stopped, so this account costs nothing and is not read.'
          : busy
            ? 'Two scrapers are running. This usually takes 10–30 seconds.'
            : `Reads ${willRead}. Both are billed.`}
      </p>
    </div>
  );
}

/**
 * When the nightly scrape next runs — 00:00 UTC, the cron's own schedule.
 *
 * Derived rather than stored, because the schedule is a fact about the system
 * and not about this account. It reuses the post countdown so the panel has one
 * ticking idiom rather than two, and that component writes to the DOM instead of
 * to React state (CLAUDE.md's navigation known-issue #2).
 */
function NextScrape() {
  const at = useMemo(() => {
    const next = new Date();
    next.setUTCHours(24, 0, 0, 0);
    return next.toISOString();
  }, []);
  return <RefreshCountdown to={at} prefix="in " className="font-medium text-white" />;
}

/**
 * The panel's section rhythm — the **section rail** (DESIGN.md §5): a plain
 * label, a hairline filling the remaining width, and anything the section wants
 * stated on the same line.
 *
 * It was the uppercase 11px eyebrow, which was wrong twice over. DESIGN.md §3
 * reserves that step for sidebar section headers — "a deliberate, single-use
 * brand device, **not a per-section scaffold**" — and this panel rendered five.
 * It also failed at the job it was chosen for: `space-y-5` gives sections the
 * same gap as the elements inside them, so a label with no rule beside it gave
 * the eye nothing to catch on down a 3,000px column. The hairline is what makes
 * "a new section starts here" visible rather than merely stated.
 *
 * `<h3>`, because the sheet's own `SheetTitle` is the `<h2>`. It used to be a
 * second `<h2>` — every section a sibling of the panel's title — and the open
 * card jumped straight to `<h4>` with no `<h3>` anywhere between them.
 */
function SectionLabel({
  children,
  aside,
}: {
  children: React.ReactNode;
  /** Stated on the rail itself — a count, a countdown. */
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="shrink-0 text-xs font-medium text-zinc-400">{children}</h3>
      <span className="h-px min-w-4 flex-1 bg-white/[0.07]" aria-hidden />
      {aside}
    </div>
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
    <details className="border-t border-white/[0.07] pt-4">
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

      {/* No "last reading" line here any more — the live line at the top of the
          panel states it, and a freshness claim in two places is the start of
          the two drifting apart. */}
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
