'use client';

import { memo, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  BookmarkIcon, ChartNoAxesColumnIncreasingIcon, ExternalLinkIcon, HeartIcon, ImageIcon,
  Loader2Icon, MessageCircleIcon, QuoteIcon, Repeat2Icon, RefreshCwIcon,
  type LucideIcon,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { formatCompact, formatCount, formatDelta, type SeriesPoint } from '@/lib/growth/metrics';
import {
  MANUAL_SYNC_COOLDOWN_MS,
  METRIC_LABEL,
  historyKeys,
  metricValue,
  postDeltaFor,
  totalEngagement,
  type PostDelta,
  type PostMetric,
  type PostVelocity,
} from '@/lib/growth/postMetrics';
import type { GrowthPost } from '@/types/firestore';

/**
 * The five figures X itself puts under a post, in X's own order and with the
 * marks it uses for them.
 *
 * This replaced a segmented "Total · Likes · Reposts · Replies · Views" picker
 * above the list. That control made the reader choose which single number every
 * card was allowed to show, when all five fit on one 16px line — and the person
 * reading this panel already knows these five glyphs by heart from the platform
 * the data came from. A control that hides four facts to reveal one is a worse
 * deal than the line that shows all five.
 *
 * `quotes` is deliberately **not** on the strip: X does not surface it under a
 * post either, and it is the one engagement component people do not scan for.
 * It keeps its row in the open card's breakdown, where nothing is competing for
 * the space.
 */
const STRIP: Array<{ metric: PostMetric; icon: LucideIcon }> = [
  { metric: 'replies', icon: MessageCircleIcon },
  { metric: 'reposts', icon: Repeat2Icon },
  { metric: 'likes', icon: HeartIcon },
  { metric: 'views', icon: ChartNoAxesColumnIncreasingIcon },
  { metric: 'bookmarks', icon: BookmarkIcon },
];

/**
 * Exactly the metrics the strip renders, so the panel builds five figures per
 * card rather than all six. `quotes` was being computed for every card on every
 * window change and thrown away — the open card recomputes its own rows.
 */
export const STRIP_METRICS: readonly PostMetric[] = STRIP.map((s) => s.metric);

/** The strip's five, plus the one it leaves out — the open card shows all six. */
const BREAKDOWN: Array<{ metric: PostMetric; icon: LucideIcon }> = [
  ...STRIP.slice(0, 3),
  { metric: 'quotes', icon: QuoteIcon },
  ...STRIP.slice(3),
];

export interface PostCardFigures {
  /** Latest reading per strip metric — absolute, as X states them. */
  totals: Partial<Record<PostMetric, number | null>>;
  /** Latest total engagement. */
  engagement: number | null;
  /** Engagement gained over the panel's window. */
  delta: PostDelta;
  /** Engagement *per day* between each pair of readings in the window. */
  rateSpark: SeriesPoint[];
  /** The rate across the two most recent readings — the sparkline's last value. */
  velocity: PostVelocity | null;
}

/**
 * One tracked post, as a card in the account panel — and, when opened, the whole
 * of that post's detail directly beneath it.
 *
 * ── It is `AccountCard`, one level down ─────────────────────────────────────
 * The same reading order, for the same reasons: identity with its state marks
 * pushed right, then the headline figure with its change beside it, then a
 * full-width sparkline on its own scale. A post inside an account is the same
 * *kind* of object as an account inside the roster — a thing with a number, a
 * change and a shape — so it should be read with the same eye movement rather
 * than as a different species of row.
 *
 * It adds one band the account card has no use for: **the platform's own metric
 * strip**, sitting directly under the post the way X puts it directly under the
 * post. That placement is not decoration — it is the layout the reader already
 * has memorised, so five numbers land without a single label being read.
 *
 * ── Everything on this card is measured over the panel's window ─────────────
 * The headline figure is where the post stands *now*; the change beside it and
 * the sparkline under it are both scoped to the window chosen in the panel
 * header, exactly as the follower section above scopes its own. One control, one
 * meaning, applied to every number on the panel that can carry a window.
 *
 * A post with fewer than two readings inside the window renders `—` and a dashed
 * hairline rather than a zero. "Nothing was measured in this window" and "this
 * did not change" are different facts, and a `0` meaning the first is a lie the
 * reader cannot detect — which is exactly why a **frozen** post reads as blank
 * under a short window instead of as flat.
 *
 * ── Two things deliberately not copied from `AccountCard` ───────────────────
 * **Colour.** That card tints its figure, its delta and its sparkline green or
 * red because a follower count genuinely falls. **Cumulative engagement
 * essentially cannot.** Carried over unchanged, every post card here would be
 * green every day — a hue that never varies encodes nothing, which is precisely
 * what the Semantic-Only Rule exists to prevent. The trace stays greyscale, and
 * the card's colour is spent on the things that *do* vary: the refresh state
 * (Action Blue while a post is young enough for its numbers to move), a failed
 * read (red), and — since a card can be opened — the open state.
 *
 * **What the sparkline draws.** The same test, applied to the other half of that
 * vocabulary, and it fails there too: a trace of the running total is a rise
 * that flattens on *every* post that ever worked, and `Sparkline` normalises to
 * its own min/max, so +3 and +1,600 draw an identical full-height climb. This
 * card draws the **rate** instead (`ratePointsFor`), zero-based — a series that
 * rises while a post spreads and decays to nothing as it settles, so "is this
 * still moving?" is legible at 36px. The figure beside it is that rate's current
 * value, which is what stops the mark being decoration.
 *
 * ── Why the detail opens here rather than in a panel ────────────────────────
 * It was a second level inside the account sheet. The trouble with that is what
 * it costs to compare: reading one post's numbers meant losing the list, and
 * comparing two meant going in and out twice with nothing on screen in between.
 * Opened in place, the post stays in its list, the neighbours stay visible, and
 * the breakdown lands directly under the strip it expands. One card is open at a
 * time (the `Accordion` above it is `type="single"`), so the list never becomes
 * a page of stacked detail.
 *
 * The excerpt stays clamped in the header even while open. Repeating the first
 * two lines is the accordion convention and it keeps the header a predictable
 * height — the alternative reflows every card below it on each open, and puts
 * the post's own words inside a button where selecting them fights the click.
 */
export const PostCard = memo(function PostCard({
  post,
  figures,
  windowLabel,
  from,
  onSync,
  onSetTracking,
  onDelete,
}: {
  post: GrowthPost;
  figures: PostCardFigures;
  /** How the window reads in prose — "over 7 days", "all time". */
  windowLabel: string;
  /** Window start as a day key, or `null` for all time. */
  from: string | null;
} & PostCardActions) {
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
      // The overlay recipe, with **open raised above every hover step**. It used
      // not to be: the trigger's hover wash composites on top of this ground, so
      // a rest of 0.025 + a hover of 0.03 rendered ≈0.054 against an open card's
      // 0.04 — every neighbour the cursor touched was brighter than the one
      // actually open, and both states drew the same 0.12 border. Open now sits
      // at 0.07 (above the composited hover) and takes the **Action Blue** edge:
      // an open card is the current selection, which is the one job DESIGN.md
      // licenses that hue for, and it is the only cue hover cannot imitate.
      className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025] transition-colors
        duration-[120ms] ease-out last:border-b
        hover:border-white/[0.12]
        data-[state=open]:border-action-blue/40 data-[state=open]:bg-white/[0.07]"
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
          {/* ── 1 · what this post is ────────────────────────────────── */}
          <span className="flex items-start gap-2.5">
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

          {/* ── 2 · the platform's own strip, where the platform puts it ──
              A five-column grid, not a flex row: under `flex … gap-x-5` each
              glyph's x-position depended on the digit width of the value before
              it, so three stacked cards put their five metrics at three
              different sets of positions and the column could not be read
              downward at all. `tabular-nums` aligns digits inside one figure and
              does nothing for this. */}
          <span className="mt-3 grid grid-cols-5 gap-x-2 gap-y-1.5">
            {STRIP.map(({ metric, icon }) => (
              <StripValue
                key={metric}
                icon={icon}
                metric={metric}
                value={figures.totals[metric] ?? null}
              />
            ))}
          </span>

          {/* ── 3 · the headline, and its change over the window ───────── */}
          <span className="mt-3 mb-2 flex items-baseline justify-between gap-2">
            <span className="flex items-baseline gap-1.5">
              {/* `formatCount`, not the account card's compact form: this panel
                  has the width for the exact figure, and `AnimatedCount` tweens
                  between two measured readings — worth more than four pixels. */}
              <AnimatedCount
                value={figures.engagement}
                subject="engagement"
                className="text-2xl font-semibold text-zinc-100"
              />
              <span className="text-[11px] text-zinc-400">engagement</span>
            </span>
            <WindowDelta delta={figures.delta} windowLabel={windowLabel} />
          </span>

          {/* ── 4 · is it still moving? ─────────────────────────────────
              The rate's shape and the rate's current value, on one line. The
              figure is what keeps the mark from being decoration: it names, in
              words, the series the line is drawing. */}
          <span className="flex items-center gap-3">
            <Sparkline
              points={figures.rateSpark}
              // Above the widest this card renders at, so the viewBox is
              // compressed rather than stretched — see `Sparkline`'s `width` note.
              width={640}
              height={36}
              zeroBased
              className="min-w-0 flex-1"
            />
            <VelocityValue velocity={figures.velocity} className="shrink-0 text-xs font-medium" />
          </span>
        </span>
      </AccordionTrigger>

      <AccordionContent className="px-4 pt-0 pb-4">
        <PostCardDetail
          post={post}
          windowLabel={windowLabel}
          from={from}
          onSync={onSync}
          onSetTracking={onSetTracking}
          onDelete={onDelete}
        />
      </AccordionContent>
    </AccordionItem>
  );
});

interface PostCardActions {
  onSync: (id: string) => Promise<{ refreshedAlongside: number }>;
  onSetTracking: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/**
 * One figure on the strip.
 *
 * The glyph is `aria-hidden` and the metric is named in text for a screen
 * reader: a heart is unambiguous to anyone who uses X and meaningless to anyone
 * who does not, and this is a console people are read aloud to on.
 *
 * An absent metric renders `—`, never `0`. X reports `views` and `bookmarks`
 * inconsistently, so the difference between "nobody bookmarked this" and "X did
 * not say" is real and has to survive.
 */
function StripValue({
  icon: Icon,
  metric,
  value,
}: {
  icon: LucideIcon;
  metric: PostMetric;
  value: number | null;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[13px] tabular-nums text-zinc-300"
      title={`${METRIC_LABEL[metric]}: ${value === null ? 'not reported' : formatCount(value)}`}
    >
      <Icon className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
      {value === null ? <span className="text-zinc-400">—</span> : formatCompact(value)}
      <span className="sr-only"> {METRIC_LABEL[metric]}</span>
    </span>
  );
}

/**
 * Engagement gained inside the panel's window.
 *
 * Green only when there is a real rise to report. A window with fewer than two
 * readings is not zero growth — it is no measurement — so it renders `—` with
 * the reason in its tooltip rather than a confident `+0`.
 */
function WindowDelta({
  delta,
  windowLabel,
  className,
}: {
  delta: PostDelta;
  windowLabel: string;
  className?: string;
}) {
  if (delta.change === null) {
    return (
      <span
        className={cn('text-xs tabular-nums text-zinc-400', className)}
        title={delta.points === 1
          ? `Only one refresh landed ${windowLabel} — a change needs two`
          : `No refreshes landed ${windowLabel}`}
      >
        — <span className="font-normal">{windowLabel}</span>
      </span>
    );
  }

  const tone = delta.change > 0
    ? 'text-green-400'
    : delta.change < 0 ? 'text-red-400' : 'text-zinc-400';

  return (
    <span className={cn('text-xs font-medium tabular-nums', tone, className)}>
      {formatDelta(delta.change)}
      <span className="ml-1 font-normal text-zinc-400">{windowLabel}</span>
    </span>
  );
}

/**
 * The open card's contents.
 *
 * A separate component because `AccordionContent` unmounts when closed, and this
 * is where the clock lives: `useSlowTick` is a real `setState`, so one per card
 * in a twenty-post list would be twenty timers and twenty re-renders every
 * thirty seconds for a countdown nineteen of them are not showing.
 *
 * ── What it is for, now that the strip carries the numbers ──────────────────
 * It used to be a grid of the same figures the collapsed card now shows, which
 * made opening a card mostly a restatement. Its job is the **second column**:
 * every metric's movement *inside the panel's window*, which is the one thing no
 * amount of space on the collapsed card could hold. The strip says where a post
 * stands; this says what it did lately, per metric, and the engagement row under
 * the rule is the sum the headline figure reports.
 */
function PostCardDetail({
  post,
  windowLabel,
  from,
  onSync,
  onSetTracking,
  onDelete,
}: {
  post: GrowthPost;
  windowLabel: string;
  from: string | null;
} & PostCardActions) {
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** Readings inside the window, newest first — the record behind every figure. */
  const readings = useMemo(
    () => historyKeys(post.history, from).reverse(),
    [post.history, from],
  );

  const rows = useMemo(() => BREAKDOWN.map(({ metric, icon }) => ({
    metric,
    icon,
    now: post.latest ? metricValue(post.latest, metric) : null,
    delta: postDeltaFor(post.history, metric, from),
  })), [post, from]);

  const engagementRow = useMemo(() => ({
    now: post.latest ? totalEngagement(post.latest) : null,
    delta: postDeltaFor(post.history, 'engagement', from),
  }), [post, from]);

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

      {/* ── The breakdown ───────────────────────────────────────────────
          Every metric the scraper returned inside the same billed result, each
          with what it did over the panel's window. A real <table>, because two
          figures per metric with a shared pair of column headings is exactly
          what a table is. */}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <caption className="sr-only">
            Each metric now, and its change {windowLabel}
          </caption>
          <thead>
            <tr className="text-[11px] text-zinc-400">
              <th scope="col" className="pb-1.5 text-left font-medium">Metric</th>
              <th scope="col" className="pb-1.5 text-right font-medium">Now</th>
              {/* `first-letter:`, not `capitalize` — CSS `capitalize` titles
                  every word, so this column read "Over 7 Days" while the same
                  string rendered lowercase everywhere else on the panel. */}
              <th scope="col" className="pb-1.5 text-right font-medium first-letter:uppercase">
                {windowLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ metric, icon: Icon, now, delta }) => (
              <tr key={metric}>
                <th scope="row" className="py-1 text-left font-normal text-zinc-300">
                  <span className="inline-flex items-center gap-2">
                    <Icon className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                    {METRIC_LABEL[metric]}
                  </span>
                </th>
                <td className="py-1 text-right tabular-nums text-zinc-100">
                  <AnimatedCount value={now} subject={metric} />
                </td>
                <td className="py-1 text-right">
                  <DeltaCell delta={delta} />
                </td>
              </tr>
            ))}
            {/* The sum the card's headline reports, under a rule because it is a
                total of the rows above rather than a seventh peer. Views and
                bookmarks sit above it but are *not* in it — views are an
                impression count orders of magnitude larger, and bookmarks are
                reported inconsistently (see `ENGAGEMENT_METRICS`). */}
            <tr className="border-t border-white/[0.07]">
              <th scope="row" className="pt-1.5 text-left font-medium text-zinc-200">
                Engagement
              </th>
              <td className="pt-1.5 text-right font-semibold tabular-nums text-zinc-100">
                <AnimatedCount value={engagementRow.now} subject="engagement" />
              </td>
              <td className="pt-1.5 text-right">
                <DeltaCell delta={engagementRow.delta} />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-zinc-400">
          Likes, reposts, replies and quotes make up engagement — views and bookmarks are reported
          alongside them but not counted in it.{' '}
          {post.latest?.authorFollowers !== undefined && (
            <>
              @{post.authorHandle ?? 'unknown'} had{' '}
              <span className="tabular-nums text-zinc-300">
                {formatCount(post.latest.authorFollowers)}
              </span>{' '}
              followers at the last reading.
            </>
          )}
        </p>
      </div>

      {/* The reading log. This is what makes every number above a measurement
          rather than a claim: each row is a moment something was actually read.
          Scoped to the window like everything else, so the log and the sparkline
          on the card describe the same stretch of time. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {/* The plain label step, not the sidebar eyebrow — see `SectionLabel`
              in AccountPanel. `<h4>` under the panel's `<h3>` section headings,
              which sit under the sheet's own `<h2>` title. */}
          <h4 className="text-xs font-medium text-zinc-400">Engagement per refresh</h4>
          <span className="text-[11px] tabular-nums text-zinc-400">
            {readings.length} {readings.length === 1 ? 'refresh' : 'refreshes'} {windowLabel}
          </span>
        </div>
        {readings.length === 0 ? (
          <p className="text-[11px] text-zinc-400">
            Nothing was read {windowLabel}.
            {post.readCount > 0 && ' Widen the window to see this post’s earlier refreshes.'}
          </p>
        ) : (
          <ol className="max-h-40 overflow-y-auto">
            {readings.map((key) => {
              const reading = metricValue(post.history[key], 'engagement');
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

/** A metric's movement inside the window, or an honest blank. */
function DeltaCell({ delta }: { delta: PostDelta }) {
  if (delta.change === null) {
    return (
      <span
        className="tabular-nums text-zinc-400"
        title={delta.points === 1
          ? 'Only one refresh in this window — a change needs two'
          : 'No refreshes in this window'}
      >
        —
      </span>
    );
  }
  const tone = delta.change > 0
    ? 'text-green-400'
    : delta.change < 0 ? 'text-red-400' : 'text-zinc-400';
  return <span className={cn('tabular-nums', tone)}>{formatDelta(delta.change)}</span>;
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 font-medium text-zinc-300">
      {children}
    </span>
  );
}
