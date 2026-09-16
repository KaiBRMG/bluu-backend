'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, SettingsIcon, TriangleAlertIcon } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FilterChip, SEGMENT_ITEM_CLASS } from '@/components/growth/growthUi';
import { AccountSearch, matchesAccountQuery } from '@/components/growth/AccountSearch';
import { AccountCard } from '@/components/growth/AccountCard';
import { AccountSheet } from '@/components/growth/AccountSheet';
import { GrowthStatCards } from '@/components/growth/GrowthStatCards';
import { SignalsStrip } from '@/components/growth/SignalsStrip';
import { ManageAccountsTab } from '@/components/growth/ManageAccountsTab';
import { PostsTab } from '@/components/growth/PostsTab';
import { useGrowthTracking } from '@/hooks/useGrowthTracking';
import { useGrowthPosts } from '@/hooks/useGrowthPosts';
import {
  RANGE_DAYS, RANGE_LABEL, deltaFor, isStale, rangeStart,
  type GrowthRange,
} from '@/lib/growth/metrics';
import { DEFAULT_SPIKE_THRESHOLD, signalsFor, spikePercent } from '@/lib/growth/signals';
import { PLATFORM_LABEL, type GrowthPlatform } from '@/lib/growth/platform';
import { GROWTH_CATEGORIES, type GrowthCategory } from '@/lib/growth/category';
import type { GrowthAccount } from '@/types/firestore';

/**
 * One filter row, two kinds of facet. Platform and category are single-select
 * together rather than two independent dimensions: the roster's categories are
 * already platform-shaped in practice (the Facebook pages are their own
 * category), so two rows of chips would mostly produce empty intersections and
 * a second thing to reset.
 */
type RosterFilter =
  | { kind: 'all' }
  | { kind: 'platform'; platform: GrowthPlatform }
  | { kind: 'category'; category: GrowthCategory };

function matchesFilter(account: GrowthAccount, filter: RosterFilter): boolean {
  if (filter.kind === 'all') return true;
  if (filter.kind === 'platform') return account.platform === filter.platform;
  return account.category === filter.category;
}

/**
 * Which of the page's three full-width surfaces is on screen. One account is not
 * among them: it opens as a **side panel over whichever of these is showing**, so
 * it is separate state (`openAccountId`) rather than a fourth variant here.
 */
type View =
  | { name: 'overview' }
  | { name: 'posts' }
  | { name: 'manage' };

/**
 * Growth Tracking (`smm-growth-tracking`) — follower history for the managed
 * Facebook pages and X accounts, read once a night by
 * `/api/cron/growth-tracking` and seeded from two months of hand-collected
 * sheets.
 *
 * ── The shape of the page ───────────────────────────────────────────────────
 * Three full-width surfaces, one of which is on screen at a time:
 *
 *  - **Overview** — the four standing figures, the Signals band, then the roster
 *    as a grid of cards, each carrying its own sparkline.
 *  - **Tracked posts** — every tracked post across the roster, with the spend
 *    ledger. The only home an orphaned post has: a manually pasted link whose
 *    author is not on the roster belongs to no account page.
 *  - **Manage accounts** — what gets scraped, and whether the scraping works.
 *
 * They are **page state, not routes**. Both hooks hold the whole payload in
 * memory, so switching views is instant and costs no read; routes would remount
 * the app shell and re-run both fetches for data that is already here (rule 9).
 * The cost is that a view is not linkable — accepted, because nothing here is
 * shared by URL.
 *
 * ── And one account, which is a panel rather than a surface ─────────────────
 * Opening an account slides [`AccountSheet`](src/components/growth/AccountSheet.tsx)
 * over whatever is on screen, and a post inside it drills to a second level in
 * the *same* panel. It is not a `View` variant because it does not replace the
 * page: the roster stays behind it, so closing is a dismissal rather than a
 * navigation back to a grid you never left.
 *
 * ── The design problem the layout solves ────────────────────────────────────
 * These accounts differ by two orders of magnitude (~684k followers against
 * ~13k). The previous overview drew them all on one shared axis and needed a
 * re-basing mode to stop the big ones flattening the small ones into the
 * baseline. A grid of cards dissolves that: every account gets its own scale,
 * and comparison is carried by the ranked figures and the Signals band instead
 * of by twelve overlapping traces.
 *
 * Deliberately unrelated to `twitterx-accounts`; see documentation/growth-tracking.md.
 */
export default function GrowthTrackingPage() {
  const {
    accounts, seriesById, loading, error, refresh,
    addAccount, setTracking, setTrackPosts, setCategory, deleteAccount,
  } = useGrowthTracking();

  // A separate collection on a separate cadence, so a separate hook and a
  // separate cache entry: the follower series changes once a night, tracked
  // posts change several times a day, and one payload would make each of them
  // pay the other's refresh rate.
  const posts = useGrowthPosts();

  const [view, setView] = useState<View>({ name: 'overview' });
  /**
   * The open account, by id rather than by document, so a refresh that replaces
   * the roster array does not leave the panel showing the copy that was current
   * when it opened.
   */
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const [range, setRange] = useState<GrowthRange>('30d');
  const [filter, setFilter] = useState<RosterFilter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [threshold, setThreshold] = useState(DEFAULT_SPIKE_THRESHOLD);

  const from = useMemo(() => rangeStart(range), [range]);

  /**
   * Switching post tracking on searches the account's timeline immediately, so
   * posts can exist the moment the toggle settles. The two hooks are deliberately
   * independent, which means neither knows about the other's data — this is the
   * one seam where they meet, and refetching only when something was actually
   * found keeps a plain toggle-off from re-reading the roster for nothing.
   */
  const handleSetTrackPosts = useCallback(async (id: string, trackPosts: boolean) => {
    const discovery = await setTrackPosts(id, trackPosts);
    if (discovery && discovery.created + discovery.refreshed > 0) await posts.refresh();
    return discovery;
  }, [setTrackPosts, posts]);

  const openAccount = useCallback((account: GrowthAccount) => {
    setOpenAccountId(account.id);
  }, []);

  const backToOverview = useCallback(() => setView({ name: 'overview' }), []);

  /**
   * What a route change would have done for us.
   *
   * These three surfaces are page state on purpose (see above), which buys an
   * instant switch and costs the two things a navigation normally provides: the
   * scroll does not reset, and focus does not move — it falls to <body> when
   * the control that was clicked unmounts, so the next Tab restarts from the
   * top of the app shell and a screen reader is never told the whole main region
   * was replaced.
   *
   * Focusing the new view's <h1> fixes both at once, and is why there is no
   * `role="status"` line beside it: moving focus to a heading announces that
   * heading, so a live region saying the same thing would double-speak. The
   * heading takes `tabIndex={-1}` only for as long as it holds focus — left on,
   * it would be a permanent quirk of the DOM for a one-off gesture.
   */
  const mainRef = useRef<HTMLDivElement>(null);
  const isFirstView = useRef(true);
  useEffect(() => {
    if (isFirstView.current) { isFirstView.current = false; return; }

    window.scrollTo({ top: 0 });

    const heading = mainRef.current?.querySelector('h1');
    if (!(heading instanceof HTMLElement)) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    const release = () => heading.removeAttribute('tabindex');
    heading.addEventListener('blur', release, { once: true });
    return () => heading.removeEventListener('blur', release);
  }, [view]);

  const accountsById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  /** The chip-filtered roster. */
  const visible = useMemo(
    () => accounts.filter((a) => matchesFilter(a, filter)),
    [accounts, filter],
  );

  /**
   * The search narrows the grid only. The tiles and the Signals band above stay
   * on the whole roster: they are its summary, and re-computing them per
   * keystroke would rewrite content sitting off-screen above the input.
   */
  const matched = useMemo(
    () => visible.filter((a) => matchesAccountQuery(a, query)),
    [visible, query],
  );

  /**
   * The threshold, as the grid sees it.
   *
   * The Signals band consumes `threshold` directly — its count and its tint have
   * to track the thumb, or dragging the slider is guesswork. The roster does
   * not: every step of a drag would otherwise re-walk each series, rebuild every
   * card object and re-path every sparkline in the grid, for a badge most cards
   * do not even show. Deferred, the grid settles once the hand stops, and React
   * keeps the drag itself at interactive priority.
   */
  const gridThreshold = useDeferredValue(threshold);

  /**
   * The grid's per-card figures, computed once here rather than per card: every
   * card needs the same range delta and the same spike reading, and doing it in
   * the card would re-walk each series on every filter keystroke.
   */
  const cards = useMemo(() => matched.map((account) => {
    const days = seriesById.get(account.id) ?? {};
    const spike = account.isActive ? spikePercent(days) : null;
    return {
      account,
      days,
      delta: deltaFor(days, from),
      // Only shown once it clears the reader's own bar — the badge means "this
      // is one of the Signals above", so the two must agree.
      spikePercent: spike !== null && spike >= gridThreshold ? spike : null,
    };
  }), [matched, seriesById, from, gridThreshold]);

  const signals = useMemo(
    () => signalsFor(accounts, seriesById, threshold),
    [accounts, seriesById, threshold],
  );

  /**
   * Only the categories the roster actually uses get a chip. A chip reading "0"
   * is a filter that leads somewhere empty, and the vocabulary is fixed in code
   * rather than in the data — so an unused one means "nothing is filed here",
   * not "you have not looked yet".
   */
  const categoryCounts = useMemo(() => {
    const counts = new Map<GrowthCategory, number>();
    for (const account of accounts) {
      if (account.category) counts.set(account.category, (counts.get(account.category) ?? 0) + 1);
    }
    return GROWTH_CATEGORIES.filter((c) => counts.has(c)).map((c) => [c, counts.get(c)!] as const);
  }, [accounts]);

  /**
   * Staleness is measured against the newest successful read across the whole
   * roster, not per account: one page going private is a per-account failure the
   * manage view reports, whereas *nothing* having been read since Tuesday means
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

  const openAccountDoc = openAccountId === null
    ? null
    : accountsById.get(openAccountId) ?? null;

  /**
   * The open account's own posts. Both `accountId` (set by the discovery pass)
   * and the author handle are checked: a post pasted by hand carries no
   * `accountId`, and filing it only by that would hide a manually tracked post
   * from the very page its author lives on.
   */
  const accountPosts = useMemo(() => {
    if (!openAccountDoc) return [];
    const handle = openAccountDoc.handleNormalized;
    return posts.posts.filter(
      (p) => p.accountId === openAccountDoc.id || p.authorHandleNormalized === handle,
    );
  }, [posts.posts, openAccountDoc]);

  return (
    <AppLayout>
      <div ref={mainRef} className="max-w-7xl space-y-4">
        {view.name === 'posts' ? (
          <SubView title="Tracked posts" onBack={backToOverview}>
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
          </SubView>
        ) : view.name === 'manage' ? (
          <SubView title="Manage accounts" onBack={backToOverview}>
            <ManageAccountsTab
              accounts={accounts}
              loading={loading}
              onAdd={addAccount}
              onSetTracking={setTracking}
              onSetTrackPosts={handleSetTrackPosts}
              onSetCategory={setCategory}
              onDelete={deleteAccount}
            />
          </SubView>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight outline-none">Growth Tracking</h1>
                <p className="text-sm text-zinc-400">
                  Follower counts for managed Facebook and X pages, read nightly ·{' '}
                  <span className="tabular-nums">{accounts.length}</span>{' '}
                  {accounts.length === 1 ? 'account' : 'accounts'} tracked
                </p>
              </div>
              {/* A page's actions sit to the right of its title, on the same row
                  (DESIGN.md §3). Both are secondary: the page's job is reading. */}
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setView({ name: 'posts' })}>
                  Tracked posts
                  <span className="tabular-nums text-zinc-400">{posts.posts.length}</span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => setView({ name: 'manage' })}>
                  <SettingsIcon className="size-4" aria-hidden />
                  Manage accounts
                </Button>
              </div>
            </div>

            {stale && (
              <p role="status" className="flex items-center gap-2 rounded-lg bg-orange-500/10 px-3 py-2 text-sm text-orange-400">
                <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                No new readings since{' '}
                {new Date(stale).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. The
                nightly scrape may have stopped.
              </p>
            )}

            {/* A failed load used to be terminal — the only way back was to
                navigate away and return. The hook already knows how to refetch. */}
            {error && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                <span>{error}</span>
                <Button size="xs" variant="outline" onClick={() => { void refresh(); }}>
                  Try again
                </Button>
              </div>
            )}

            {loading ? (
              <OverviewSkeleton />
            ) : accounts.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No accounts are tracked yet.{' '}
                <button
                  type="button"
                  onClick={() => setView({ name: 'manage' })}
                  className="text-zinc-300 underline underline-offset-2 transition-colors hover:text-white"
                >
                  Add one
                </button>{' '}
                and its follower count is recorded from tonight onwards.
              </p>
            ) : (
              <>
                <GrowthStatCards accounts={accounts} seriesById={seriesById} />

                <SignalsStrip
                  signals={signals}
                  accountsById={accountsById}
                  threshold={threshold}
                  onThresholdChange={setThreshold}
                  onOpen={openAccount}
                />

                {/* Every control here filters the grid below it, so all of them
                    sit above it. Rendered underneath, changing the range visibly
                    mutated content off-screen upward. */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FilterChip
                      active={filter.kind === 'all'}
                      onClick={() => setFilter({ kind: 'all' })}
                      count={accounts.length}
                    >
                      All accounts
                    </FilterChip>
                    {(['facebook', 'twitter'] as const).map((p) => (
                      <FilterChip
                        key={p}
                        active={filter.kind === 'platform' && filter.platform === p}
                        onClick={() => setFilter({ kind: 'platform', platform: p })}
                        count={accounts.filter((a) => a.platform === p).length}
                      >
                        {PLATFORM_LABEL[p]}
                      </FilterChip>
                    ))}
                    {/* The categories carry their own hue in both states — a
                        closed vocabulary with a meaning per value is the one
                        label DESIGN.md lets colour. The hairline divider keeps
                        them legible as a second facet in one row. */}
                    {categoryCounts.length > 0 && (
                      <span className="mx-1 h-4 w-px bg-white/[0.12]" aria-hidden />
                    )}
                    {categoryCounts.map(([category, count]) => (
                      <FilterChip
                        key={category}
                        category={category}
                        active={filter.kind === 'category' && filter.category === category}
                        onClick={() => setFilter({ kind: 'category', category })}
                        count={count}
                      >
                        {category}
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

                <AccountSearch
                  value={query}
                  onChange={setQuery}
                  resultCount={matched.length}
                  totalCount={visible.length}
                />

                {matched.length === 0 ? (
                  // Every filtered-empty state carries its own way out
                  // (DESIGN.md §6), and which way out depends on which filter
                  // emptied it.
                  <p className="text-sm text-zinc-400">
                    {visible.length === 0 ? (
                      <>
                        No{' '}
                        {filter.kind === 'platform'
                          ? PLATFORM_LABEL[filter.platform]
                          : filter.kind === 'category'
                            ? filter.category
                            : ''}{' '}
                        accounts are tracked.{' '}
                        <button
                          type="button"
                          onClick={() => setFilter({ kind: 'all' })}
                          className="text-zinc-300 underline underline-offset-2 transition-colors hover:text-white"
                        >
                          Show all {accounts.length}
                        </button>
                        .
                      </>
                    ) : (
                      <>
                        No account matches “{query.trim()}”.{' '}
                        <button
                          type="button"
                          onClick={() => setQuery('')}
                          className="text-zinc-300 underline underline-offset-2 transition-colors hover:text-white"
                        >
                          Clear the search
                        </button>
                        .
                      </>
                    )}
                  </p>
                ) : (
                  <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))]">
                    {cards.map((card) => (
                      <AccountCard
                        key={card.account.id}
                        account={card.account}
                        days={card.days}
                        from={from}
                        delta={card.delta}
                        spikePercent={card.spikePercent}
                        onOpen={openAccount}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Outside the view switch on purpose: an account is a panel *over* the
            page, and the roster it was opened from stays on screen behind it. It
            is reachable from the Signals band too, which renders on the overview
            — so it belongs to the page, not to one of its surfaces. */}
        <AccountSheet
          account={openAccountDoc}
          days={openAccountDoc ? seriesById.get(openAccountDoc.id) ?? {} : {}}
          range={range}
          posts={accountPosts}
          postsLoading={posts.loading}
          onOpenChange={(open) => { if (!open) setOpenAccountId(null); }}
          onTrackPost={posts.trackPost}
          onSyncPost={posts.syncPost}
          onSetPostTracking={posts.setPostTracking}
          onDeletePost={posts.deletePost}
          onLoadFullPostHistory={posts.loadFullHistory}
          onSetTrackPosts={handleSetTrackPosts}
        />
      </div>
    </AppLayout>
  );
}

/**
 * The frame the two secondary surfaces share — a back control and a heading, in
 * the same place the account panel puts its own back control, so leaving any
 * detail in this subsystem is the same gesture in the same spot.
 */
function SubView({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 h-8 text-zinc-400">
        <ArrowLeftIcon className="size-4" aria-hidden />
        Back to overview
      </Button>
      <h1 className="text-2xl font-bold tracking-tight outline-none">{title}</h1>
      {children}
    </div>
  );
}


/** Shaped to the real layout so nothing jumps when the data lands. */
function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
      </div>
      <Skeleton className="h-[168px] rounded-xl" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-72 rounded-full" />
        <Skeleton className="h-8 w-56 rounded-lg" />
      </div>
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))]">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-[152px] rounded-xl" />)}
      </div>
    </div>
  );
}
