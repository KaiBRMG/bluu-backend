'use client';

import { useRef } from 'react';
import dynamic from 'next/dynamic';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { DayMap, GrowthRange } from '@/lib/growth/metrics';
import type { GrowthCategory } from '@/lib/growth/category';
import type { RefreshAccountResult, TrackPostsResult } from '@/hooks/useGrowthTracking';
import type { GrowthAccount, GrowthPost } from '@/types/firestore';

/**
 * The panel body is the only thing in this subsystem that pulls recharts — its
 * follower chart, and the post chart on its second level. The roster's
 * sparklines are hand-drawn SVG precisely so the overview never parses that
 * library; a static import here would put it back. Split out, it is fetched the
 * first time someone opens an account, behind a skeleton shaped like the panel.
 *
 * `ssr: false` because this page is a client component inside the Electron
 * shell; there is no server pass to preserve.
 */
const AccountPanel = dynamic(
  () => import('./AccountPanel').then((m) => m.AccountPanel),
  { ssr: false, loading: () => <PanelSkeleton /> },
);

/**
 * One account, as a side panel over the roster.
 *
 * The shell is deliberately static and tiny: it owns the Sheet and nothing else,
 * so the dynamic boundary sits *inside* the panel and the skeleton can be
 * panel-shaped. Put the boundary around the Sheet instead and the first click on
 * a card does nothing visible until the chunk lands.
 *
 * `account` is `null` while closed, which both drives `open` and empties the
 * panel — the same construction `PostDetailSheet` uses, and what makes reopening
 * an account always start at the account level rather than wherever the previous
 * visit was left.
 */
export function AccountSheet({
  account,
  days,
  range,
  posts,
  postsLoading,
  onOpenChange,
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
  account: GrowthAccount | null;
  days: DayMap;
  range: GrowthRange;
  posts: GrowthPost[];
  postsLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onTrackPost: (url: string) => Promise<void>;
  onSyncPost: (id: string) => Promise<{ refreshedAlongside: number }>;
  onSetPostTracking: (id: string, isActive: boolean) => Promise<void>;
  onDeletePost: (id: string) => Promise<void>;
  onLoadFullPostHistory: (id: string) => Promise<void>;
  onSetTrackPosts: (id: string, trackPosts: boolean) => Promise<TrackPostsResult>;
  onSetTracking: (id: string, isActive: boolean) => Promise<number>;
  onSetCategory: (id: string, category: GrowthCategory | null) => Promise<void>;
  onRefreshAccount: (id: string) => Promise<RefreshAccountResult>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Sheet open={account !== null} onOpenChange={onOpenChange}>
      {/*
        Wider than the post panel's `max-w-xl`: this one carries a chart, a
        control deck and a list of posts, where that one carries a post.

        `overflow-hidden`, **not** `overflow-y-auto` — the scroll lives on the
        panel's body instead (see `AccountPanel`). When this element scrolled,
        two things went with it: the Window control, which scopes every figure
        below it and sat ~2,600px above the reader by post 14, and shadcn's own
        close button, which is `absolute` inside this box and therefore scrolls
        with its content. A panel whose whole argument is "a peek" had no visible
        exit from its second screenful.
      */}
      <SheetContent
        ref={contentRef}
        /* `.focus()` on a plain <div> does nothing, and Radix then falls back to
           the first tabbable — which is the whole thing being avoided here. */
        tabIndex={-1}
        className="w-full gap-0 overflow-hidden sm:max-w-2xl"
        /*
          Radix hands opening focus to the first tabbable descendant. Once the
          header gained the category picker that became a `<button>` that writes
          data — so every account opened with a focus ring on it, and the first
          Tab started *past* the panel's own header. Focusing the panel instead
          keeps the trap intact, lets the title be what a screen reader
          announces, and leaves the header quiet.
        */
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        {account && (
          <AccountPanel
            key={account.id}
            account={account}
            days={days}
            range={range}
            posts={posts}
            postsLoading={postsLoading}
            onTrackPost={onTrackPost}
            onSyncPost={onSyncPost}
            onSetPostTracking={onSetPostTracking}
            onDeletePost={onDeletePost}
            onLoadFullPostHistory={onLoadFullPostHistory}
            onSetTrackPosts={onSetTrackPosts}
            onSetTracking={onSetTracking}
            onSetCategory={onSetCategory}
            onRefreshAccount={onRefreshAccount}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Shaped to the panel, because the only thing being waited for is the recharts
 * chunk — the data is already in memory. A layout that settles into place is the
 * difference between a fast open and a broken one.
 *
 * The `sr-only` title is not decoration: Radix names the dialog from its
 * `SheetTitle`, and for the frame or two this stands in for the panel there
 * would otherwise be none.
 */
function PanelSkeleton() {
  return (
    <>
      {/* Same two-part frame as the real panel — fixed header band, scrolling
          body — so nothing jumps when the chunk lands. */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-white/[0.07] p-4">
        <SheetTitle className="sr-only">Loading account</SheetTitle>
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40 rounded-lg" />
            <Skeleton className="h-4 w-24 rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-5 w-56 rounded-lg" />
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-4 pb-6">
        <Skeleton className="h-[132px] rounded-xl" />
        <Skeleton className="h-[236px] rounded-xl" />
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[62px] rounded-lg" />)}
        </div>
      </div>
    </>
  );
}
