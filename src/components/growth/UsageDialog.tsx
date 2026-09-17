'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  ChevronLeftIcon, ChevronRightIcon, MinusIcon, RefreshCwIcon,
  TrendingDownIcon, TrendingUpIcon, TriangleAlertIcon,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SURFACE, HAIRLINE } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { formatAge } from '@/lib/growth/postMetrics';
import { useSlowTick } from './postUi';
import { useApifyUsage } from '@/hooks/useApifyUsage';
import type { ApifyUsageReport } from '@/types/firestore';

/**
 * What Apify actually charged us, month by month.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 * Tracked posts used to show a cost, and that cost was an **estimate** —
 * billed results × a unit price typed into a constant, covering the tweet actor
 * and nothing else. It excluded the nightly follower scrapes (the larger half
 * of the bill), it could not see platform usage riding on the same run, and it
 * had no way to know whether the store page's price was the price we pay. Every
 * figure in this dialog comes from Apify's own run and usage records instead.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 * Three questions, in the order a person asks them: *what did this month cost*
 * (the headline), *where did it go* (per actor, and per day), and *what
 * specifically did that* (the call log). The log is last and it is the reason
 * the dialog is wide: "every refresh/call" is only answerable by showing the
 * individual runs, with the cost attached to each one.
 *
 * Nothing here is a projection. A month in progress is shown as what it has
 * cost **so far**, never extrapolated to a month-end figure — this surface is
 * the one that finally replaced a made-up number, so it must not introduce a
 * different one.
 */

// ─── Month arithmetic ────────────────────────────────────────────────

/**
 * Stepped locally rather than with `components/salary/MonthPicker`, which looks
 * identical and is not interchangeable: that control's month boundary is
 * `Africa/Harare` because a salary day is (cross-cutting rule 9f). Runs are
 * bucketed by UTC day in the service, so the picker has to be UTC too — a
 * picker whose "September" is two hours out from the aggregation's is a bug
 * that shows up once a month, at the worst possible moment.
 */
function monthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function stepMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

// ─── Money ───────────────────────────────────────────────────────────

/**
 * These amounts span four orders of magnitude — a single refresh is fractions
 * of a cent and a month is a few dollars — so a fixed two decimals would render
 * most of the call log as `$0.00` and make the dialog look broken. Precision
 * follows magnitude, and a genuine zero is the one value allowed to read `$0`:
 * a run that has not finished has not been billed yet, and padding it out to
 * `$0.0000` implies a measurement that has not happened.
 */
function money(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
}

function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

function formatDuration(secs: number | null): string {
  if (secs === null) return '—';
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// ─── Pieces ──────────────────────────────────────────────────────────

function Tile({
  label, value, meta, title,
}: {
  label: string;
  value: ReactNode;
  meta?: string;
  title?: string;
}) {
  return (
    <div className={cn('rounded-xl px-4 py-3', SURFACE)} title={title}>
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-50">{value}</div>
      {/* zinc-400, not zinc-500: DESIGN.md rules Ink Muted out as a text colour
          entirely — it fails AA on every ground in this app, the near-black
          canvas included. The same applies to every muted line below. */}
      {meta && <div className="mt-0.5 text-[11px] text-zinc-400">{meta}</div>}
    </div>
  );
}

/**
 * Month against month, on a like-for-like window.
 *
 * The comparison is against *the same number of days into last month*, not
 * against last month entire — seventeen days of September set beside all of
 * August reads as a 45% saving nobody made, and a cost surface that cries wolf
 * once is never read again. The window is named in the tile's meta line so the
 * comparison is checkable rather than trusted.
 *
 * Greyscale, deliberately. Hue in this system means status, and spend moving a
 * few percent is not a status — an arrow and a number say it without spending
 * the one colour that means "act here".
 */
function TrendTile({ usage, month, current }: { usage: ApifyUsageReport; month: string; current: string }) {
  const c = usage.comparison;

  if (!c || c.toDateUsd <= 0) {
    return (
      <Tile
        label="Against last month"
        value="—"
        meta={c ? 'nothing billed last month' : 'no record of last month yet'}
      />
    );
  }

  const change = (usage.totalUsd - c.toDateUsd) / c.toDateUsd;
  const Icon = Math.abs(change) < 0.005 ? MinusIcon : change > 0 ? TrendingUpIcon : TrendingDownIcon;
  const sign = change > 0 ? '+' : '';
  const sameDays = month === current;

  return (
    <Tile
      label="Against last month"
      value={
        <span className="flex items-baseline gap-1.5">
          <Icon className="size-4 shrink-0 self-center text-zinc-400" aria-hidden />
          {sign}{(change * 100).toFixed(0)}%
        </span>
      }
      meta={sameDays
        ? `vs ${money(c.toDateUsd)} by day ${c.dayReached} of ${monthLabel(c.month).split(' ')[0]}`
        : `vs ${money(c.toDateUsd)} in ${monthLabel(c.month).split(' ')[0]}`}
      title={sameDays
        ? `Compared against the first ${c.dayReached} days of ${monthLabel(c.month)} ` +
          `(${money(c.toDateUsd)}), not the whole month (${money(c.totalUsd)}), so the ` +
          `comparison is like for like.`
        : `${monthLabel(c.month)} totalled ${money(c.totalUsd)}.`}
    />
  );
}

/**
 * A day-by-day bar row, drawn by hand.
 *
 * No charting library: this is one series of at most 31 values with no axes, no
 * tooltip layer and no interaction beyond a native `title` — precisely the case
 * DESIGN.md's sparkline rule says not to mount a chart instance for. A day with
 * no runs renders as an empty column rather than a zero-height bar sitting on
 * the axis, so "nothing ran" and "something ran and cost nothing" stay
 * distinguishable.
 */
function DailyBars({ usage }: { usage: ApifyUsageReport }) {
  const days = useMemo(() => {
    const start = new Date(`${usage.month}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const total = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    const byDate = new Map(usage.daily.map((d) => [d.date, d]));
    return Array.from({ length: total }, (_, i) => {
      const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      return { date, entry: byDate.get(date) ?? null };
    });
  }, [usage.month, usage.daily]);

  const peak = Math.max(...usage.daily.map((d) => d.usd), 0);
  if (peak === 0) return null;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Spend by day</h3>
        <span className="text-[11px] text-zinc-400">peak {money(peak)} · UTC days</span>
      </div>
      <div
        className="mt-2 flex h-24 items-end gap-[3px]"
        role="list"
        aria-label={`Daily spend for ${monthLabel(usage.month)}`}
      >
        {days.map(({ date, entry }) => (
          <div
            key={date}
            role="listitem"
            className="group flex h-full flex-1 items-end"
            title={entry
              ? `${date}: ${money(entry.usd)} across ${entry.runs} run${entry.runs === 1 ? '' : 's'}`
              : `${date}: nothing ran`}
          >
            {entry && (
              <div
                className="w-full rounded-sm bg-action-blue/70 transition-colors group-hover:bg-action-blue"
                style={{ height: `${Math.max(2, (entry.usd / peak) * 100)}%` }}
              />
            )}
            <span className="sr-only">
              {date}: {entry ? `${money(entry.usd)}, ${entry.runs} runs` : 'nothing ran'}
            </span>
          </div>
        ))}
      </div>
      <div className={cn('mt-1 flex justify-between border-t pt-1 text-[10px] text-zinc-400', HAIRLINE)} aria-hidden>
        <span>1</span>
        <span>{days.length}</span>
      </div>
    </div>
  );
}

function ActorBreakdown({ usage }: { usage: ApifyUsageReport }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-200">Where it went</h3>
      {/* The window is narrow in a small Electron frame and these are
          five-column tables; overflowing horizontally beats crushing the actor
          name to three characters. */}
      <div className="mt-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Actor</TableHead>
              <TableHead className="w-24 text-right">Runs</TableHead>
              <TableHead className="w-24 text-right">Failed</TableHead>
              <TableHead className="w-28 text-right">Cost</TableHead>
              <TableHead className="w-28 text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.actors.map((actor) => {
              const share = usage.totalUsd > 0 ? actor.usd / usage.totalUsd : 0;
              return (
                <TableRow key={actor.actorId}>
                  <TableCell>
                    <div className="text-sm text-zinc-100">{actor.label ?? actor.actorName}</div>
                    {/* The store slug is kept under our own label rather than
                        replacing it: the label is what a reader recognises, and
                        the slug is what they would search the Apify console for. */}
                    <div className="truncate text-[11px] text-zinc-400">{actor.actorName}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-300">{actor.runs}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {actor.failed > 0
                      ? <span className="text-red-400">{actor.failed}</span>
                      : (
                      <>
                        <span className="text-zinc-400" aria-hidden>—</span>
                        <span className="sr-only">none</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-100">{money(actor.usd)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="h-full rounded-full bg-action-blue" style={{ width: `${share * 100}%` }} />
                      </div>
                      <span className="w-10 text-right tabular-nums text-[11px] text-zinc-400">
                        {(share * 100).toFixed(0)}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RunStatus({ status }: { status: string }) {
  const tone = status === 'SUCCEEDED'
    ? 'text-zinc-400'
    : status === 'RUNNING' || status === 'READY'
      // status-blue ("in progress"), not Action Blue: the accent means "act
      // here" and belongs to controls. A run being underway is information.
      ? 'text-blue-400'
      : 'text-red-400';
  return <span className={cn('text-[11px] font-medium', tone)}>{status.toLowerCase()}</span>;
}

function RunLog({ usage }: { usage: ApifyUsageReport }) {
  /**
   * Runs are named with the short label the breakdown above already taught the
   * reader, not the store slug. `kaitoeasyapi/twitter-x-data-tweet-scraper-pay-
   * per-result-cheapest` is sixty characters that are identical on most rows —
   * it would take the widest column in the table to say nothing that varies.
   * The slug stays in the row's `title` for anyone about to search the Apify
   * console for it.
   */
  const labels = useMemo(
    () => new Map(usage.actors.map((a) => [a.actorId, a.label ?? a.actorName])),
    [usage.actors],
  );

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Every call</h3>
        <span className="text-[11px] text-zinc-400">
          {usage.recentRuns.length} most recent · times in UTC
        </span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <Table>
          <TableHeader>
            {/* Sticky: sixty rows scroll well past the header inside the
                dialog's own scroll area, and a cost column nobody can label is
                a column nobody reads. The ground is opaque rather than the
                overlay recipe, so rows do not show through it. */}
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky top-0 z-10 w-36 bg-background">Started</TableHead>
              <TableHead className="sticky top-0 z-10 bg-background">Actor</TableHead>
              <TableHead className="sticky top-0 z-10 w-24 bg-background">Status</TableHead>
              <TableHead className="sticky top-0 z-10 w-24 bg-background text-right">Took</TableHead>
              <TableHead className="sticky top-0 z-10 w-24 bg-background text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.recentRuns.map((run) => (
              <TableRow key={run.id} title={run.actorName}>
                <TableCell className="tabular-nums text-zinc-300">{formatDateTime(run.startedAt)}</TableCell>
                <TableCell className="text-zinc-400">{labels.get(run.actorId) ?? run.actorName}</TableCell>
                <TableCell><RunStatus status={run.status} /></TableCell>
                <TableCell className="text-right tabular-nums text-zinc-400">
                  {formatDuration(run.durationSecs)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-100">{money(run.usd)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * When these figures were taken.
 *
 * Subscribed to the slow tick so it does not sit frozen at "just now" for the
 * ten minutes someone leaves the dialog open — on a surface whose entire claim
 * is that its numbers are real, a staleness label that lies about its own age
 * is the one thing that cannot be allowed to drift. 30s granularity, well under
 * the smallest unit it prints.
 */
function SyncedAt({ syncedAt }: { syncedAt: string | null }) {
  useSlowTick();
  return (
    <span className="text-[11px] text-zinc-400">
      {syncedAt ? `Read from Apify ${formatAge(syncedAt)}` : 'Reading from Apify…'}
    </span>
  );
}

// ─── The dialog ──────────────────────────────────────────────────────

export function UsageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [month, setMonth] = useState(monthKey);

  // `null` while closed, so nothing is fetched until someone actually asks.
  const { usage, loading, refreshing, error, refresh } = useApifyUsage(open ? month : null);

  const current = monthKey();
  const previous = stepMonth(month, -1);
  const next = stepMonth(month, 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wide, because the call log is a five-column table and the whole point
          of it is per-call attribution: narrowed to the app's default dialog
          width the actor column truncates to nothing and the log stops
          answering the question it was added for. */}
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className={cn('shrink-0 border-b px-6 py-4', HAIRLINE)}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pr-10">
            <div className="min-w-0">
              <DialogTitle>Apify usage</DialogTitle>
              <DialogDescription className="mt-1">
                What the follower scrapes and post refreshes actually cost, read from
                Apify&rsquo;s own billing records.
              </DialogDescription>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setMonth(previous)}
                aria-label={`Previous month, ${monthLabel(previous)}`}
              >
                <ChevronLeftIcon aria-hidden />
              </Button>
              <span className="min-w-[9.5rem] text-center text-sm font-medium tabular-nums" aria-live="polite">
                {monthLabel(month)}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={next > current}
                onClick={() => setMonth(next)}
                aria-label={`Next month, ${monthLabel(next)}`}
              >
                <ChevronRightIcon aria-hidden />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {loading && !usage ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
          ) : error && !usage ? (
            <div className="space-y-3">
              <p className="text-sm text-red-400">{error}</p>
              <Button size="sm" variant="outline" onClick={refresh}>Try again</Button>
            </div>
          ) : usage ? (
            <>
              {/* A stale read is labelled, not hidden. The figures below are
                  real — they are just older than this moment, and saying so is
                  the difference between a cached number and a wrong one. */}
              {usage.staleReason && (
                <div className="flex items-start gap-2 rounded-lg border border-orange-500/20 bg-orange-500/[0.06] px-3 py-2">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-orange-400" aria-hidden />
                  <p className="text-[12px] text-orange-200/90">
                    Apify could not be reached, so these are the figures from the last
                    successful read. {usage.staleReason}
                  </p>
                </div>
              )}

              {/* The tiles render for an empty month too, at zero. Dropping
                  them for "nothing ran" made the whole dialog change shape as
                  you stepped months, which reads as a load failure rather than
                  as a quiet month. */}
              <div className="grid gap-3 sm:grid-cols-3">
                <Tile
                  label="Billed"
                  value={money(usage.totalUsd)}
                  meta={month === current ? 'so far this month' : 'month complete'}
                />
                <Tile
                  label="Actor runs"
                  value={usage.runs.toLocaleString('en-US')}
                  meta={usage.runs === 0
                    ? 'nothing ran'
                    : `across ${usage.actors.length} actor${usage.actors.length === 1 ? '' : 's'}`}
                />
                <TrendTile usage={usage} month={month} current={current} />
              </div>

              {/* Apify's own cycle total, stated as a separate period rather
                  than reconciled with the figure above — a billing cycle need
                  not start on the 1st. The caveat that the two are different
                  windows moved into the title: it is a thing to check once, not
                  a paragraph to re-read on every open. */}
              {usage.cycle && (
                <p
                  className="text-[11px] text-zinc-400"
                  title="A billing cycle need not start on the 1st, so this window and the calendar month above are not the same period. A large gap between them means runs are being started outside this app."
                >
                  Apify billing cycle {formatDayMonth(usage.cycle.startAt)}–{formatDayMonth(usage.cycle.endAt)}:{' '}
                  <span className="tabular-nums text-zinc-200">{money(usage.cycle.creditsUsd)}</span>
                  {' '}account-wide
                </p>
              )}

              {usage.runs === 0 ? (
                <p className="text-sm text-zinc-400">
                  No actor ran in {monthLabel(month)} — no follower scrape, no post refresh —
                  so there is nothing to break down.
                </p>
              ) : (
                <>
                  <DailyBars usage={usage} />
                  <ActorBreakdown usage={usage} />
                  {usage.recentRuns.length > 0 && <RunLog usage={usage} />}
                </>
              )}
            </>
          ) : null}
        </div>

        <div className={cn('flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3', HAIRLINE)}>
          <SyncedAt syncedAt={usage?.syncedAt ?? null} />
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || loading}>
            <RefreshCwIcon className={cn('size-4', refreshing && 'animate-spin')} aria-hidden />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
