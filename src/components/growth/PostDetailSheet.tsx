'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ExternalLinkIcon, ImageIcon, Loader2Icon, RefreshCwIcon,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SEGMENT_ITEM_CLASS } from './growthUi';
import {
  AnimatedCount, PostAuthorAvatar, ReadFreshness, RefreshCountdown, RefreshStatePill,
  VelocityValue, useSlowTick,
} from './postUi';
import { formatCompact, formatCount } from '@/lib/growth/metrics';
import {
  MANUAL_SYNC_COOLDOWN_MS,
  METRIC_LABEL,
  POST_METRICS,
  REFRESH_STATE_LABEL,
  ageHoursOf,
  historyKeys,
  metricValue,
  pointsForMetric,
  refreshStateFor,
  totalEngagement,
  velocityFor,
  type PostMetric,
} from '@/lib/growth/postMetrics';
import type { GrowthPost } from '@/types/firestore';

type SheetMetric = PostMetric | 'engagement';

const CHART_METRICS: SheetMetric[] = ['engagement', 'likes', 'reposts', 'replies', 'views'];

const config = {
  value: { label: 'Refresh', color: '#3b82f6' },
} satisfies ChartConfig;

/**
 * One post, in full — built on `AccountDetailSheet`'s construction.
 *
 * This is where the free extras earn their place. The table shows one metric at
 * a time because eight columns of numbers cannot be scanned; here there is room
 * for every field the scraper returned inside the same billed result, including
 * the author's follower count at the moment of reading.
 *
 * ── The two honesty devices ─────────────────────────────────────────────────
 * Everything here is a number without a visible timestamp, which on its own
 * would read as a claim of liveness. Two things prevent that:
 *  - the **reading log** at the bottom, which states every moment a number was
 *    actually taken (and every read that failed), and
 *  - the **countdown** in the header, which says when the next one is due
 *    instead of implying the current one is current.
 */
export function PostDetailSheet({
  post,
  onOpenChange,
  onSync,
  onSetTracking,
  onDelete,
}: {
  post: GrowthPost | null;
  onOpenChange: (open: boolean) => void;
  onSync: (id: string) => Promise<{ refreshedAlongside: number }>;
  onSetTracking: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [metric, setMetric] = useState<SheetMetric>('engagement');
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const view = useMemo(() => {
    if (!post) return null;
    const rows = pointsForMetric(post.history, metric).map((p) => ({
      t: p.t,
      ms: p.ms,
      value: p.value,
    }));
    return {
      rows,
      velocity: velocityFor(post.history, metric),
      readings: historyKeys(post.history).reverse(),
      ageHours: ageHoursOf(post.postedAt),
    };
  }, [post, metric]);

  // Affordance only — the server owns this window and 429s inside it. Subscribed
  // to the slow tick so the button re-enables itself while the sheet stays open;
  // without it a sheet left open would show "Wait 14m" forever. Reading the clock
  // in a memo keyed on the tick keeps it out of the render path.
  const tick = useSlowTick();
  const cooldownLeft = useMemo(() => {
    if (!post?.lastManualSyncAt) return 0;
    return MANUAL_SYNC_COOLDOWN_MS - (Date.now() - Date.parse(post.lastManualSyncAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is the clock
  }, [post?.lastManualSyncAt, tick]);
  const onCooldown = cooldownLeft > 0;

  const sync = async () => {
    if (!post) return;
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
    if (!post) return;
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
    if (!post) return;
    setConfirmDelete(false);
    setBusy(true);
    try {
      await onDelete(post.id);
      toast.success('Deleted that post and all of its history.');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that post.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={post !== null} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
          {post && view && (
            <>
              <SheetHeader className="gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <RefreshStatePill post={post} />
                  <span className="text-[11px] text-zinc-400">
                    {post.isActive
                      ? REFRESH_STATE_LABEL[refreshStateFor(view.ageHours)]
                      : 'Not being refreshed'}
                  </span>
                </div>

                <div className="flex items-start gap-3">
                  <PostAuthorAvatar post={post} className="size-10" />
                  <div className="min-w-0">
                    <SheetTitle className="truncate text-lg">
                      @{post.authorHandle ?? 'unknown'}
                    </SheetTitle>
                    <SheetDescription asChild>
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-fit items-center gap-1 text-sm text-zinc-400 underline-offset-2 transition-colors hover:text-white hover:underline"
                      >
                        View on X
                        <ExternalLinkIcon className="size-3" aria-hidden />
                      </a>
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-6 px-4 pb-6">
                {/* The post's own words. `pretty` because this is prose, and an
                    orphaned last word under a two-line post looks like a bug. */}
                <p className="max-w-[65ch] whitespace-pre-wrap text-sm leading-relaxed text-zinc-200 [text-wrap:pretty]">
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
                  {post.media.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.08] px-1.5 py-0.5 font-medium text-zinc-300">
                      <ImageIcon className="size-3" aria-hidden />
                      {post.media.length} {post.media.length === 1 ? 'attachment' : 'attachments'}
                    </span>
                  )}
                  {post.isQuote && <Tag>Quote post</Tag>}
                  {post.isReply && <Tag>Reply</Tag>}
                  {post.source === 'account' && <Tag>Found automatically</Tag>}
                </div>

                {/* ── The live line ──────────────────────────────────────────
                    Next reading, last reading, and the one control that buys a
                    reading now. Grouped because they answer one question:
                    "how current is what I am looking at?" */}
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
                      ? <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                      : <RefreshCwIcon className="size-3.5" aria-hidden />}
                    {syncing ? 'Refreshing…' : onCooldown ? `Wait ${Math.ceil(cooldownLeft / 60_000)}m` : 'Refresh now'}
                  </Button>
                </div>

                {/* Every metric the scraper returned, all free inside the same
                    billed result. Absent ones render an em dash, never a zero. */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
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
                    hint="Captured alongside this post, inside the same billed result, and written through to the account's follower history on the Followers tab."
                  >
                    <AnimatedCount value={post.latest?.authorFollowers ?? null} subject="authorFollowers" />
                  </Stat>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">
                      {metric === 'engagement' ? 'Engagement' : METRIC_LABEL[metric]} over time
                    </h3>
                    <ToggleGroup
                      type="single"
                      value={metric}
                      onValueChange={(v) => v && setMetric(v as SheetMetric)}
                      variant="outline"
                      size="sm"
                      aria-label="Metric"
                    >
                      {CHART_METRICS.map((m) => (
                        <ToggleGroupItem key={m} value={m} className={SEGMENT_ITEM_CLASS}>
                          {m === 'engagement' ? 'Total' : METRIC_LABEL[m]}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>

                  <p className="text-[11px] text-zinc-400">
                    Rate between the last two refreshes:{' '}
                    <VelocityValue velocity={view.velocity} />
                  </p>

                  {view.rows.length >= 2 ? (
                    <ChartContainer config={config} className="h-[200px] w-full">
                      <LineChart data={view.rows} margin={{ left: 4, right: 8, top: 8 }}>
                        <CartesianGrid vertical={false} strokeOpacity={0.12} />
                        <XAxis
                          dataKey="t" tickLine={false} axisLine={false} tickMargin={8} minTickGap={40}
                          tickFormatter={(v: string) => new Date(`${v}:00Z`).toLocaleString('en-GB', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        />
                        {/* Scaled to the data, not zero-based: engagement on an
                            established post barely moves proportionally, and a
                            zero-based axis would flatten the only thing this
                            chart exists to show. */}
                        <YAxis
                          tickLine={false} axisLine={false} tickMargin={8} width={48}
                          domain={['dataMin', 'dataMax']}
                          tickFormatter={(v: number) => formatCompact(v)}
                        />
                        <ChartTooltip
                          content={<ChartTooltipContent
                            labelFormatter={(v) => new Date(`${v}:00Z`).toLocaleString('en-GB', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}
                            formatter={(value) => formatCount(Number(value))}
                          />}
                        />
                        <Line
                          dataKey="value"
                          type="monotone"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={{ r: 2, fill: '#3b82f6' }}
                          activeDot={{ r: 4 }}
                          // A reading that failed is a gap, not a drop. Bridging
                          // it is the same rule the follower chart follows.
                          connectNulls
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <p className="rounded-lg bg-white/[0.04] px-3 py-6 text-center text-sm text-zinc-400">
                      {view.rows.length === 1
                        ? 'One refresh so far. A line needs two — the next one is on the way.'
                        : 'No data for this metric yet. X does not report every metric on every post.'}
                    </p>
                  )}
                </div>

                {/* The reading log. This is what makes every number above a
                    measurement rather than a claim: each row is a moment
                    something was actually read. */}
                <details className="group">
                  <summary className="cursor-pointer list-none text-sm font-medium text-zinc-300 transition-colors hover:text-white">
                    Refresh log
                    <span className="ml-2 text-[11px] font-normal text-zinc-400">
                      {view.readings.length} {view.readings.length === 1 ? 'refresh' : 'refreshes'}
                      {post.readCount > view.readings.length && ' shown'}
                    </span>
                  </summary>
                  <ol className="mt-2 space-y-1">
                    {view.readings.map((key) => {
                      const value = metricValue(post.history[key], metric);
                      return (
                        <li
                          key={key}
                          className="flex items-baseline justify-between gap-3 rounded-sm px-1 py-0.5 text-[11px]"
                        >
                          <span className="tabular-nums text-zinc-400">
                            {new Date(`${key}:00Z`).toLocaleString('en-GB', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                          <span className="tabular-nums text-zinc-300">
                            {value === null ? '—' : formatCount(value)}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                  {post.lastReadStatus === 'failed' && post.lastReadError && (
                    <p className="mt-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">
                      {post.lastReadError}
                    </p>
                  )}
                </details>

                <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
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
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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
    </>
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
      <p className="text-[11px] text-zinc-400" title={hint}>{label}</p>
      <p className="text-xl font-semibold tabular-nums text-zinc-100">{children}</p>
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
