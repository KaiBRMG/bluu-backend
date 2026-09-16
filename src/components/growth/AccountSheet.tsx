'use client';

import dynamic from 'next/dynamic';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { DayMap, GrowthRange } from '@/lib/growth/metrics';
import type { TrackPostsResult } from '@/hooks/useGrowthTracking';
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
}) {
  return (
    <Sheet open={account !== null} onOpenChange={onOpenChange}>
      {/* Wider than the post panel's `max-w-xl`: this one carries a chart, a
          control deck and a list of posts, where that one carries a post. */}
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
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
      <div className="flex flex-col gap-3 p-4">
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
      <div className="space-y-5 px-4 pb-6">
        <Skeleton className="h-[132px] rounded-xl" />
        <Skeleton className="h-[236px] rounded-xl" />
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[62px] rounded-lg" />)}
        </div>
      </div>
    </>
  );
}
