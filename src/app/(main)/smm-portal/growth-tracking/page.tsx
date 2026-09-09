'use client';

import { useMemo, useState } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FilterChip, SEGMENT_ITEM_CLASS } from '@/components/growth/growthUi';
import { GrowthChart } from '@/components/growth/GrowthChart';
import { GrowthSummary } from '@/components/growth/GrowthSummary';
import { GrowthLeaderboard } from '@/components/growth/GrowthLeaderboard';
import { AccountDetailSheet } from '@/components/growth/AccountDetailSheet';
import { ManageAccountsTab } from '@/components/growth/ManageAccountsTab';
import { PostsTab } from '@/components/growth/PostsTab';
import { useGrowthTracking } from '@/hooks/useGrowthTracking';
import { useGrowthPosts } from '@/hooks/useGrowthPosts';
import {
  GROWTH_MODES, MODE_LABEL, RANGE_DAYS, RANGE_LABEL,
  isStale, rangeStart, type GrowthMode, type GrowthRange,
} from '@/lib/growth/metrics';
import { PLATFORM_LABEL, type GrowthPlatform } from '@/lib/growth/platform';
import type { GrowthAccount } from '@/types/firestore';

type PlatformFilter = GrowthPlatform | 'all';

/**
 * Growth Tracking (`smm-growth-tracking`) — follower history for the managed
 * Facebook pages and X accounts, read once a night by
 * `/api/cron/growth-tracking` and seeded from two months of hand-collected
 * sheets.
 *
 * The design problem the layout solves: these accounts differ by two orders of
 * magnitude (~684k followers against ~13k). Any shared linear axis flattens most
 * of them into a line along the bottom, so the default mode is **indexed growth**
 * — everything re-based to 0% at the range start — and raw counts are one of the
 * other two modes rather than the default. See `GrowthChart` for how the field
 * of lines resolves into one named trace.
 *
 * Deliberately unrelated to `twitterx-accounts`; see documentation/growth-tracking.md.
 */
export default function GrowthTrackingPage() {
  const {
    accounts, seriesById, loading, error, refresh,
    addAccount, setTracking, setTrackPosts, deleteAccount,
  } = useGrowthTracking();

  // A separate collection on a separate cadence, so a separate hook and a
  // separate cache entry: the follower series changes once a night, tracked
  // posts change several times a day, and one payload would make each of them
  // pay the other's refresh rate.
  const posts = useGrowthPosts();

  const [range, setRange] = useState<GrowthRange>('30d');
  const [mode, setMode] = useState<GrowthMode>('indexed');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [openAccount, setOpenAccount] = useState<GrowthAccount | null>(null);

  const from = useMemo(() => rangeStart(range), [range]);

  const visible = useMemo(
    () => accounts.filter((a) => platform === 'all' || a.platform === platform),
    [accounts, platform],
  );

  /**
   * Staleness is measured against the newest successful read across the whole
   * roster, not per account: one page going private is a per-account failure the
   * manage tab reports, whereas *nothing* having been read since Tuesday means
   * the nightly job itself has stopped, which is the only thing worth a banner.
   */
  const stale = useMemo(() => {
    const newest = accounts
      .map((a) => a.lastScrapeAt)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null;
    return newest !== null && isStale(newest) ? newest : null;
  }, [accounts]);

  return (
    <AppLayout>
      <div className="max-w-7xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Growth Tracking</h1>
          <p className="text-sm text-zinc-400">
            Follower counts for managed Facebook and X pages, read nightly. Individual X posts
            are read more often while they are new — see the Posts tab.
          </p>
        </div>

        {stale && (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-orange-500/10 px-3 py-2 text-sm text-orange-400">
            <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
            No new readings since{' '}
            {new Date(stale).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. The
            nightly scrape may have stopped.
          </p>
        )}

        {/* A failed load used to be terminal — the only way back was to navigate
            away and return. The hook already knows how to refetch. */}
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            <span>{error}</span>
            <Button size="xs" variant="outline" onClick={() => { void refresh(); }}>
              Try again
            </Button>
          </div>
        )}

        <Tabs defaultValue="followers">
          <TabsList>
            <TabsTrigger value="followers">Followers</TabsTrigger>
            <TabsTrigger value="posts">Posts</TabsTrigger>
            <TabsTrigger value="manage">Manage Accounts</TabsTrigger>
          </TabsList>

          <TabsContent value="followers" className="space-y-4">
            {loading ? (
              <FollowersSkeleton />
            ) : accounts.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No accounts are tracked yet. Add one under Manage Accounts and its follower count
                is recorded from tonight onwards.
              </p>
            ) : (
              <>
                {/* Both controls filter the tiles, the chart and the table
                    below them, so they sit above all three. Rendered under the
                    chart, changing the range visibly mutated content off-screen
                    upward. */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['all', 'facebook', 'twitter'] as const).map((p) => (
                      <FilterChip
                        key={p}
                        active={platform === p}
                        onClick={() => setPlatform(p)}
                        count={p === 'all'
                          ? accounts.length
                          : accounts.filter((a) => a.platform === p).length}
                      >
                        {p === 'all' ? 'All accounts' : PLATFORM_LABEL[p]}
                      </FilterChip>
                    ))}
                  </div>
                  <ToggleGroup
                    type="single"
                    value={range}
                    onValueChange={(v) => v && setRange(v as GrowthRange)}
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

                <GrowthSummary
                  accounts={visible}
                  seriesById={seriesById}
                  from={from}
                  range={range}
                />

                <Card className="gap-3 py-4">
                  {/* CardHeader is a grid, not a flex row — the trailing control
                      belongs in CardAction, which is what switches the header to
                      `grid-cols-[1fr_auto]`. */}
                  <CardHeader className="px-4">
                    <CardTitle className="text-sm font-semibold">{MODE_LABEL[mode]}</CardTitle>

                    <CardAction>
                      <ToggleGroup
                        type="single"
                        value={mode}
                        onValueChange={(v) => v && setMode(v as GrowthMode)}
                        variant="outline"
                        size="sm"
                        aria-label="Chart mode"
                      >
                        {GROWTH_MODES.map((m) => (
                          <ToggleGroupItem key={m} value={m} className={SEGMENT_ITEM_CLASS}>
                            {MODE_LABEL[m]}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="px-4">
                    <GrowthChart
                      accounts={visible}
                      seriesById={seriesById}
                      from={from}
                      mode={mode}
                      highlightId={highlightId}
                      onHighlight={setHighlightId}
                    />
                  </CardContent>
                </Card>

                {visible.length === 0 ? (
                  <p className="text-sm text-zinc-400">
                    No {PLATFORM_LABEL[platform as GrowthPlatform]} accounts are tracked.{' '}
                    <button
                      type="button"
                      onClick={() => setPlatform('all')}
                      className="text-zinc-300 underline underline-offset-2 transition-colors hover:text-white"
                    >
                      Show all {accounts.length}
                    </button>
                    .
                  </p>
                ) : (
                  <GrowthLeaderboard
                    accounts={visible}
                    seriesById={seriesById}
                    from={from}
                    highlightId={highlightId}
                    onHighlight={setHighlightId}
                    onOpen={setOpenAccount}
                  />
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="posts">
            <PostsTab
              posts={posts.posts}
              spend={posts.spend}
              loading={posts.loading}
              error={posts.error}
              onRetry={() => { void posts.refresh(); }}
              onTrack={posts.trackPost}
              onSync={posts.syncPost}
              onSetTracking={posts.setPostTracking}
              onDelete={posts.deletePost}
              onLoadFullHistory={posts.loadFullHistory}
            />
          </TabsContent>

          <TabsContent value="manage">
            <ManageAccountsTab
              accounts={accounts}
              loading={loading}
              onAdd={addAccount}
              onSetTracking={setTracking}
              onSetTrackPosts={setTrackPosts}
              onDelete={deleteAccount}
            />
          </TabsContent>
        </Tabs>
      </div>

      <AccountDetailSheet
        account={openAccount}
        days={openAccount ? seriesById.get(openAccount.id) ?? {} : {}}
        from={from}
        range={range}
        onOpenChange={(open) => { if (!open) setOpenAccount(null); }}
      />
    </AppLayout>
  );
}

/** Shaped to the real layout so nothing jumps when the data lands. */
function FollowersSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-64 rounded-full" />
        <Skeleton className="h-8 w-56 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
      </div>
      <Skeleton className="h-[420px] rounded-xl" />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-11 rounded-lg" />)}
      </div>
    </div>
  );
}
