'use client';

import { memo, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLinkIcon, ImageIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react';
import {
  AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sparkline } from './Sparkline';
import { ScrapeFailedBadge } from './growthUi';
import {
  AnimatedCount, ReadFreshness, RefreshCountdown, RefreshStatePill, VelocityValue,
  postExcerpt, useSlowTick,
} from './postUi';
import { formatCount, type SeriesPoint } from '@/lib/growth/metrics';
import {
  MANUAL_SYNC_COOLDOWN_MS,
  METRIC_LABEL,
  POST_METRICS,
  historyKeys,
  metricValue,
  totalEngagement,
  type PostMetric,
  type PostVelocity,
} from '@/lib/growth/postMetrics';
import type { GrowthPost } from '@/types/firestore';

export type CardMetric = PostMetric | 'engagement';

/**
 * One tracked post, as a card in the account panel — and, when opened, the whole
 * of that post's detail directly beneath it.
 *
 * ── It is `AccountCard`, one level down ─────────────────────────────────────
 * Same three bands, in the same order, for the same reasons: an identity block
 * with its state marks pushed to the right, then the headline figure with its
 * rate beside it, then a full-width sparkline on its own scale. A post inside an
 * account is the same *kind* of object as an account inside the roster — a thing
 * with a number, a rate and a shape — so it should be read with the same eye
 * movement rather than as a different species of row.
 *
 * ── The one band that is deliberately not the same: colour ──────────────────
 * `AccountCard` tints its figure, its delta and its sparkline green or red,
 * because a follower count genuinely falls. **Cumulative engagement essentially
 * cannot.** Carried over unchanged, every post card in the panel would be green
 * every day — a hue that never varies encodes nothing, which is precisely what
 * the Semantic-Only Rule exists to prevent. So the trace here stays greyscale
 * and the card's colour is spent on the two things that *do* vary: the refresh
 * state (Action Blue while a post is still young enough for its numbers to move)
 * and a failed read (red). `VelocityValue` keeps its own tone because a rate
 * that has gone flat or negative is the exception worth seeing.
 *
 * ── Why the detail opens here rather than in a panel ────────────────────────
 * It was a second level inside the account sheet. The trouble with that is what
 * it costs to compare: reading one post's numbers meant losing the list, and
 * comparing two meant going in and out twice with nothing on screen in between.
 * Opened in place, the post stays in its list, the neighbours stay visible, and
 * the reading log lands directly under the sparkline it explains. One card is
 * open at a time (the `Accordion` above it is `type="single"`), so the list
 * never becomes a page of stacked detail.
 *
 * The excerpt stays clamped in the header even while open. Repeating the first
 * two lines is the accordion convention and it keeps the header a predictable
 * height — the alternative reflows every card below it on each open, and puts
 * the post's own words inside a button where selecting them fights the click.
 *
 * ── No chart in the expansion, on purpose ───────────────────────────────────
 * The standalone post sheet on the roster-wide **Tracked posts** view draws one,
 * and that is where it belongs: it is one post, alone, with the width for it.
 * Here the reading log states every moment a number was actually taken, which is
 * the same truth in the form that survives at this size — and a recharts
 * instance per open card in a scrolling panel is exactly the cost this
 * subsystem hand-draws its sparklines to avoid.
 */
export const PostCard = memo(function PostCard({
  post,
  metric,
  value,
  velocity,
  spark,
  onSync,
  onSetTracking,
  onDelete,
}: {
  post: GrowthPost;
  /** Which metric `value` measures — a change snaps the count instead of tweening. */
  metric: CardMetric;
  value: number | null;
  velocity: PostVelocity | null;
  spark: SeriesPoint[];
  onSync: (id: string) => Promise<{ refreshedAlongside: number }>;
  onSetTracking: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const posted = post.postedAt
    ? new Date(post.postedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'Date unknown';

  // Same gate as the account card's: a post that is not being refreshed has a
  // frozen `lastReadStatus`, and rendering that as a live failure reports a job
  // that is not running and cannot fail.
  const readFailed = post.isActive && post.lastReadStatus === 'failed';

  return (
    <AccordionItem
      value={post.id}
      // The overlay recipe, and open is a *raised* step of it rather than a
      // different colour — the card lifts toward the reader instead of
      // announcing itself (DESIGN.md §4, The No-Shadow Rule).
      className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025] transition-colors
        duration-[120ms] ease-out last:border-b
        hover:border-white/[0.12]
        data-[state=open]:border-white/[0.12] data-[state=open]:bg-white/[0.04]"
    >
      <AccordionTrigger
        // The overlay hover steps, layered over the card's own ground, rather
        // than a brightness nudge (DESIGN.md § Interaction). The ring is the
        // house `--ring` the primitive already draws — only inset, so the card's
        // rounding cannot clip it.
        className="w-full items-start gap-3 rounded-none px-4 py-3.5 font-normal
          transition-colors duration-[120ms] ease-out
          hover:bg-white/[0.03] hover:no-underline active:bg-white/[0.055]
          focus-visible:ring-inset
          [&>svg]:mt-1 [&>svg]:text-zinc-400"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          {/* ── Band 1 · what this post is ───────────────────────────── */}
          <span className="mb-3 flex items-start gap-2.5">
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100">
                {postExcerpt(post.text, 180)}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                <span className="tabular-nums">{posted}</span>
                {post.media.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="size-3" aria-hidden />
                      {post.media.length}
                      <span className="sr-only">
                        {post.media.length === 1 ? 'attachment' : 'attachments'}
                      </span>
                    </span>
                  </>
                )}
              </span>
            </span>
            {/* Stacked rather than competing for one slot, error first — a read
                can fail on a post that is otherwise refreshing normally. */}
            <span className="flex shrink-0 flex-col items-end gap-1">
              {readFailed && <ScrapeFailedBadge error={post.lastReadError} />}
              <RefreshStatePill post={post} />
            </span>
          </span>

          {/* ── Band 2 · the figure, and the rate beside it ───────────── */}
          <span className="mb-2 flex items-baseline justify-between gap-2">
            {/* `formatCount`, not the card's compact form: this panel has the
                width for the exact figure, and `AnimatedCount` tweens between two
                measured readings — a fact worth more here than four saved pixels. */}
            <AnimatedCount
              value={value}
              subject={metric}
              className="text-2xl font-semibold text-zinc-100"
            />
            <VelocityValue velocity={velocity} className="text-xs font-medium" />
          </span>

          {/* ── Band 3 · the shape ───────────────────────────────────── */}
          <Sparkline
            points={spark}
            // Above the widest this card renders at, so the viewBox is
            // compressed rather than stretched — see `Sparkline`'s `width` note.
            width={640}
            height={36}
            className="w-full"
          />
        </span>
      </AccordionTrigger>

      <AccordionContent className="px-4 pt-0 pb-4">
        <PostCardDetail
          post={post}
          metric={metric}
          onSync={onSync}
          onSetTracking={onSetTracking}
          onDelete={onDelete}
        />
      </AccordionContent>
    </AccordionItem>
  );
});

/**
 * The open card's contents.
 *
 * A separate component because `AccordionContent` unmounts when closed, and this
 * is where the clock lives: `useSlowTick` is a real `setState`, so one per card
 * in a twenty-post list would be twenty timers and twenty re-renders every
 * thirty seconds for a countdown nineteen of them are not showing.
 */
function PostCardDetail({
  post,
  metric,
  onSync,
  onSetTracking,
  onDelete,
}: {
  post: GrowthPost;
  metric: CardMetric;
  onSync: (id: string) => Promise<{ refreshedAlongside: number }>;
  onSetTracking: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const readings = useMemo(() => historyKeys(post.history).reverse(), [post.history]);

  // Affordance only — the server owns this window and 429s inside it. Subscribed
  // to the slow tick so the button re-enables itself while the card stays open;
  // without it an open card would show "Wait 14m" forever.
  const tick = useSlowTick();
  const cooldownLeft = useMemo(() => {
    if (!post.lastManualSyncAt) return 0;
    return MANUAL_SYNC_COOLDOWN_MS - (Date.now() - Date.parse(post.lastManualSyncAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is the clock
  }, [post.lastManualSyncAt, tick]);
  const onCooldown = cooldownLeft > 0;

  const sync = async () => {
    setSyncing(true);
    try {
      const { refreshedAlongside } = await onSync(post.id);
      toast.success(
        refreshedAlongside > 0
          ? `Refreshed this post, and ${refreshedAlongside} other${refreshedAlongside === 1 ? '' : 's'} on the same call.`
          : 'Refreshed this post.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not refresh that post.');
    } finally {
      setSyncing(false);
    }
  };

  const setTracking = async (isActive: boolean) => {
    setBusy(true);
    try {
      await onSetTracking(post.id, isActive);
      toast.success(isActive
        ? 'Refreshing this post again.'
        : 'Stopped refreshing this post. Its history is kept.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update that post.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      await onDelete(post.id);
      toast.success('Deleted that post and all of its history.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that post.');
    } finally {
      setBusy(false);
    }
  };

  const metricLabel = metric === 'engagement' ? 'Engagement' : METRIC_LABEL[metric];

  return (
    <div className="space-y-4 border-t border-white/[0.07] pt-4">
      {/* The post's own words, in full and selectable — which is the whole
          reason they are out here rather than in the header's button.
          `pretty` because this is prose, and an orphaned last word under a
          two-line post looks like a bug. */}
      <p className="max-w-[65ch] whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-200 [text-wrap:pretty]">
        {post.text || <span className="text-zinc-400">This post has no text.</span>}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
        {post.postedAt && (
          <span className="tabular-nums">
            Posted {new Date(post.postedAt).toLocaleString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}
        {post.isQuote && <Tag>Quote post</Tag>}
        {post.isReply && <Tag>Reply</Tag>}
        {post.source === 'account' && <Tag>Found automatically</Tag>}
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline-offset-2 transition-colors hover:text-white hover:underline"
        >
          View on X
          <ExternalLinkIcon className="size-3" aria-hidden />
        </a>
      </div>

      {/* ── The live line ───────────────────────────────────────────────
          Next reading, last reading, and the one control that buys a reading
          now. Grouped because they answer one question: "how current is what I
          am looking at?" */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2.5">
        <div className="space-y-0.5">
          <p className="text-[11px] text-zinc-400">
            Refreshed <ReadFreshness post={post} className="inline" />
          </p>
          <p className="text-sm text-zinc-200">
            {post.isActive ? (
              <>
                Next refresh{' '}
                <RefreshCountdown to={post.nextRefreshAt} prefix="in " className="font-medium text-white" />
              </>
            ) : (
              'No further refreshes scheduled'
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={sync}
          disabled={syncing || busy || onCooldown}
          title={onCooldown
            ? `Refreshed by hand recently. Available again in ${Math.ceil(cooldownLeft / 60_000)} minutes.`
            : 'Refresh this post now, along with the 19 that have waited longest'}
        >
          {syncing
            ? <Loader2Icon className="activity-spinner size-3.5 animate-spin" aria-hidden />
            : <RefreshCwIcon className="size-3.5" aria-hidden />}
          {syncing ? 'Refreshing…' : onCooldown ? `Wait ${Math.ceil(cooldownLeft / 60_000)}m` : 'Refresh now'}
        </Button>
      </div>

      {/* Every metric the scraper returned, all free inside the same billed
          result. The card above shows one because a list can only be scanned on
          one; here there is room for all of them. Absent ones render an em dash,
          never a zero. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Engagement">
          <AnimatedCount value={post.latest ? totalEngagement(post.latest) : null} subject="engagement" />
        </Stat>
        {POST_METRICS.map((m) => (
          <Stat key={m} label={METRIC_LABEL[m]}>
            <AnimatedCount value={post.latest ? metricValue(post.latest, m) : null} subject={m} />
          </Stat>
        ))}
        <Stat
          label="Author followers"
          hint="Captured alongside this post, inside the same billed result, and written through to the account's follower history."
        >
          <AnimatedCount value={post.latest?.authorFollowers ?? null} subject="authorFollowers" />
        </Stat>
      </dl>

      {/* The reading log. This is what makes every number above a measurement
          rather than a claim: each row is a moment something was actually read.
          It reports whichever metric the list is ranked on, so the toggle above
          the panel re-keys the sparkline and this together. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400">
            {metricLabel} per refresh
          </h4>
          <span className="text-[11px] tabular-nums text-zinc-400">
            {readings.length} {readings.length === 1 ? 'refresh' : 'refreshes'}
            {post.readCount > readings.length && ' shown'}
          </span>
        </div>
        {readings.length === 0 ? (
          <p className="text-[11px] text-zinc-400">Nothing read yet.</p>
        ) : (
          <ol className="max-h-40 overflow-y-auto">
            {readings.map((key) => {
              const reading = metricValue(post.history[key], metric);
              return (
                <li
                  key={key}
                  className="flex items-baseline justify-between gap-3 py-0.5 text-[11px]"
                >
                  <span className="tabular-nums text-zinc-400">
                    {new Date(`${key}:00Z`).toLocaleString('en-GB', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  <span className="tabular-nums text-zinc-300">
                    {reading === null ? '—' : formatCount(reading)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {post.lastReadStatus === 'failed' && post.lastReadError && (
          <p className="mt-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">
            {post.lastReadError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-3">
        <Button
          variant="ghost" size="sm" className="h-7 text-xs"
          disabled={busy}
          onClick={() => setTracking(!post.isActive)}
        >
          {post.isActive ? 'Stop refreshing' : 'Resume refreshing'}
        </Button>
        {!post.isActive && (
          <Button
            variant="ghost" size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </Button>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the post and every engagement figure recorded for it. That history
              cannot be collected again — the scraper only ever returns a post’s numbers as they
              are right now. If you only want to stop the refresh cost, leave it stopped instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] text-zinc-400" title={hint}>{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-zinc-100">{children}</dd>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 font-medium text-zinc-300">
      {children}
    </span>
  );
}
