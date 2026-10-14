'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { AttrChip, BasisTag, LegendSwatch } from '@/components/buddyx/buddyxUi';
import { dayKeyToDate } from '@/components/buddyx/PeriodPicker';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatCount } from '@/lib/buddyx/analyticsFormat';
import { SALE_KIND_COLORS } from '@/lib/buddyx/chartColors';
import type { ChatterDailyPoint, IntegrityFlag, SalesBoardRow, TeamSales } from '@/lib/buddyx/analyticsTypes';

/**
 * The sales board — Chatter Analytics' primary surface (DESIGN.md §5, the
 * sales board). One ranked list, every agent named, ranked by gross; each row
 * draws its PPV + tips as a bar on **one shared scale**, so the gaps between
 * agents read before any figure does. The viewer's own row is the screen's one
 * Action Blue mark, as "you" was on the benchmark strip it replaced.
 *
 * Everything here is sales — the row type carries nothing else, because every
 * agent sees every row.
 */

const gross = (r: { ppvGross: number; tipsGross: number }) => r.ppvGross + r.tipsGross;

/** "6 Oct – 12 Oct", or "1 – 30 Sep" inside one month. */
export function formatDayRange(from: string, to: string): string {
  const a = dayKeyToDate(from);
  const b = dayKeyToDate(to);
  if (!a || !b) return `${from} – ${to}`;
  if (from === to) return format(a, 'd MMM');
  return from.slice(0, 7) === to.slice(0, 7) ? `${format(a, 'd')} – ${format(b, 'd MMM')}` : `${format(a, 'd MMM')} – ${format(b, 'd MMM')}`;
}

/**
 * Change against the comparison period, as an arrow and a percentage. Nothing
 * when there is no comparison; "new" when the earlier period was empty, since
 * any growth from zero is infinite and says nothing.
 */
export function ChangeTag({ now, prev, className }: { now: number; prev: number | null; className?: string }) {
  if (prev === null) return null;
  if (prev <= 0) {
    return now > 0 ? <span className={cn('text-zinc-400', className)}>new this period</span> : null;
  }
  const change = (now - prev) / prev;
  const pct = Math.round(Math.abs(change) * 100);
  if (pct === 0) return <span className={cn('text-zinc-400', className)}>level</span>;
  const up = change > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={cn('inline-flex items-center gap-0.5 tabular-nums', up ? 'text-green-400' : 'text-orange-400', className)}>
      <Icon className="size-3" aria-hidden />
      <span className="sr-only">{up ? 'up' : 'down'}</span>
      {pct}%
    </span>
  );
}

/** PPV then tips, as one bar whose length is `gross ÷ scale`. */
function SplitBar({ ppv, tips, scale, className }: { ppv: number; tips: number; scale: number; className?: string }) {
  const width = (v: number) => (scale > 0 ? `${(Math.max(v, 0) / scale) * 100}%` : '0%');
  return (
    <span
      role="img"
      aria-label={`PPV ${formatUsd(ppv)}, tips ${formatUsd(tips)}`}
      className={cn('flex h-2.5 w-full gap-px overflow-hidden rounded-[3px] bg-white/[0.04]', className)}
    >
      <span className="h-full rounded-l-[3px]" style={{ width: width(ppv), background: SALE_KIND_COLORS.ppv }} />
      <span className="h-full last:rounded-r-[3px]" style={{ width: width(tips), background: SALE_KIND_COLORS.tip }} />
    </span>
  );
}

function PersonAvatar({ name, photoURL }: { name: string; photoURL: string | null }) {
  return (
    <Avatar className="size-6 shrink-0" style={{ background: getAvatarColor(name) }}>
      {photoURL && <AvatarImage src={photoURL} alt="" />}
      <AvatarFallback className="text-[10px]" style={{ background: getAvatarColor(name), color: '#fff' }}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

const SEVERITY_DOT = { high: 'bg-red-400', medium: 'bg-orange-400' } as const;

/** Column template: rank · agent · bar · gross · detail (stacked below 640px). */
const ROW_GRID =
  'grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[2rem_minmax(0,12rem)_minmax(0,1fr)_6.5rem_minmax(0,10rem)]';

export function SalesBoard({
  rows,
  viewerUid,
  flagsByUid,
  hrefFor,
  ratesShown,
}: {
  rows: SalesBoardRow[];
  viewerUid: string | null;
  /** Admin only: a dot beside a name with flags. */
  flagsByUid?: Map<string, IntegrityFlag[]>;
  /** Admin only: the agent's report. Without it, rows are not links. */
  hrefFor?: (uid: string) => string;
  /** False when the range is too long for per-hour rates (they are null). */
  ratesShown: boolean;
}) {
  const linked = rows.filter(r => r.uid);
  const unlinked = rows.filter(r => !r.uid);
  const scale = Math.max(0, ...rows.map(gross));

  if (linked.length === 0 && unlinked.length === 0) {
    return <p className="text-sm text-zinc-400">No sales and nobody rostered in this period.</p>;
  }

  return (
    <div className={cn('rounded-xl', SURFACE)}>
      <div className={cn(ROW_GRID, 'hidden border-b border-white/[0.07] px-4 py-2.5 text-[11px] font-medium text-zinc-400 sm:grid')} aria-hidden>
        <span className="text-right">#</span>
        <span>Agent</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.ppv} /> PPV</span>
          <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.tip} /> Tips</span>
        </span>
        <span className="inline-flex items-center justify-end gap-1.5">Sales <BasisTag basis="gross" /></span>
        <span>{ratesShown ? 'Per clocked hour' : 'Accounts'}</span>
      </div>
      {/* The legend again for narrow screens, where the header row is hidden. */}
      <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-2.5 text-[11px] text-zinc-400 sm:hidden">
        <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.ppv} /> PPV</span>
        <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.tip} /> Tips</span>
        <BasisTag basis="gross" />
      </div>

      <ol className="space-y-px p-1.5" aria-label="Agents ranked by gross sales">
        {linked.map((row, i) => (
          <BoardRow
            key={row.uid}
            row={row}
            rank={i + 1}
            scale={scale}
            isViewer={row.uid === viewerUid}
            flags={flagsByUid?.get(row.uid!) ?? []}
            href={hrefFor ? hrefFor(row.uid!) : undefined}
            ratesShown={ratesShown}
          />
        ))}
      </ol>

      {unlinked.length > 0 && (
        <div className="border-t border-white/[0.07]">
          <p className="px-4 pt-3 text-[11px] text-zinc-400">
            BuddyX chatters linked to no Bluu agent — their sales are BuddyX&apos;s own figures and hold no place. Link them in CA Admin.
          </p>
          <ul className="space-y-px p-1.5">
            {unlinked.map(row => (
              <BoardRow key={row.name} row={row} rank={null} scale={scale} isViewer={false} flags={[]} ratesShown={false} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BoardRow({
  row,
  rank,
  scale,
  isViewer,
  flags,
  href,
  ratesShown,
}: {
  row: SalesBoardRow;
  rank: number | null;
  scale: number;
  isViewer: boolean;
  flags: IntegrityFlag[];
  href?: string;
  ratesShown: boolean;
}) {
  const total = gross(row);
  const salesMade = row.ppvSales + row.tipsCount;
  const severity = flags.some(f => f.severity === 'high') ? 'high' : flags.length > 0 ? 'medium' : null;

  const body = (
    <>
      <span className="order-1 text-right text-xs tabular-nums text-zinc-400">{rank ?? '—'}</span>

      <span className="order-2 flex min-w-0 items-center gap-2">
        <PersonAvatar name={row.name} photoURL={row.photoURL} />
        <span className="truncate text-sm font-medium">{row.name}</span>
        {isViewer && <AttrChip className="shrink-0 bg-action-blue/20 text-blue-200">You</AttrChip>}
        {severity && (
          <span className="inline-flex shrink-0 items-center" title={`${flags.length} ${flags.length === 1 ? 'flag' : 'flags'} — see What needs a look`}>
            <span className={cn('size-1.5 rounded-full', SEVERITY_DOT[severity])} aria-hidden />
            <span className="sr-only">
              {flags.length} {flags.length === 1 ? 'flag' : 'flags'}, {severity} severity
            </span>
          </span>
        )}
      </span>

      <span className="order-3 text-right sm:order-4">
        <span className={cn('block text-[15px] font-semibold leading-tight tabular-nums', total === 0 && 'text-zinc-400')}>{formatUsd(total)}</span>
        <span className="block text-[11px] tabular-nums text-zinc-400">
          {salesMade === 0 ? 'no sales' : `${formatCount(salesMade)} ${salesMade === 1 ? 'sale' : 'sales'}`}
        </span>
      </span>

      <SplitBar ppv={row.ppvGross} tips={row.tipsGross} scale={scale} className="order-4 col-span-2 col-start-2 sm:order-3 sm:col-span-1 sm:col-start-auto" />

      <span className="order-5 col-span-2 col-start-2 flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-400 sm:col-span-1 sm:col-start-auto sm:block">
        {ratesShown && (
          <span className="tabular-nums text-zinc-300 sm:block">
            {row.grossPerHour !== null ? `${formatUsd(row.grossPerHour)} / h` : row.uid ? 'under 1h clocked' : '—'}
          </span>
        )}
        <span className="inline-flex flex-wrap items-baseline gap-x-2 text-[11px]">
          {row.accounts > 0 && <span className="tabular-nums">{row.accounts} {row.accounts === 1 ? 'account' : 'accounts'}</span>}
          <ChangeTag now={total} prev={row.prevGross} />
        </span>
      </span>
    </>
  );

  const rowClass = cn(
    ROW_GRID,
    'rounded-lg px-2.5 py-2.5',
    isViewer && 'bg-action-blue/[0.08] ring-1 ring-inset ring-action-blue/30',
  );

  if (href) {
    return (
      <li>
        <Link
          href={href}
          prefetch={false}
          className={cn(
            rowClass,
            'hover:bg-white/[0.055] active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
          )}
        >
          {body}
        </Link>
      </li>
    );
  }
  return <li className={rowClass}>{body}</li>;
}

const dailyConfig = {
  tipsGross: { label: 'Tips', color: SALE_KIND_COLORS.tip },
  ppvGross: { label: 'PPV', color: SALE_KIND_COLORS.ppv },
} satisfies ChartConfig;

/** Gross by day, tips stacked under PPV. Shared by the team band, the agent's own trend and the report. */
export function DailySalesChart({ daily, className }: { daily: ChatterDailyPoint[]; className?: string }) {
  return (
    <ChartContainer config={dailyConfig} className={cn('h-[200px] w-full', className)}>
      <BarChart data={daily} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} tickFormatter={d => String(Number(String(d).slice(8)))} />
        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={v => formatUsd(Number(v))} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={l => formatDayLabelWithWeekday(String(l))}
              formatter={(v, n) => [` ${formatUsd(Number(v))}`, n === 'tipsGross' ? 'Tips' : 'PPV']}
            />
          }
        />
        <Bar dataKey="tipsGross" stackId="k" fill="var(--color-tipsGross)" stroke="var(--card)" strokeWidth={2} />
        <Bar dataKey="ppvGross" stackId="k" fill="var(--color-ppvGross)" stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * The team's money for the period: one figure, how it moved, the split, and
 * the shape of the period by day. Composed as one band, not a row of tiles —
 * the board below is where the agents are.
 */
export function TeamSalesBand({ team }: { team: TeamSales }) {
  const total = gross(team);
  return (
    <section className={cn('grid gap-6 rounded-xl p-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]', SURFACE)} aria-labelledby="team-sales">
      <div className="flex flex-col">
        <h2 id="team-sales" className="flex items-center gap-1.5 text-sm font-semibold">
          Team sales <BasisTag basis="gross" />
        </h2>
        <p className="mt-3 text-3xl font-semibold leading-none tabular-nums">{formatUsd(total)}</p>
        {team.prev && (
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-400">
            <ChangeTag now={total} prev={team.prev.gross} className="font-medium" />
            <span>
              vs {formatUsd(team.prev.gross)}, {formatDayRange(team.prev.from, team.prev.to)}
            </span>
          </p>
        )}
        <div className="mt-auto pt-5">
          <SplitBar ppv={team.ppvGross} tips={team.tipsGross} scale={Math.max(total, 0)} />
          <dl className="mt-2 flex gap-5 text-xs">
            <div className="flex items-center gap-1.5">
              <LegendSwatch color={SALE_KIND_COLORS.ppv} />
              <dt className="text-zinc-400">PPV</dt>
              <dd className="tabular-nums">{formatUsd(team.ppvGross)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <LegendSwatch color={SALE_KIND_COLORS.tip} />
              <dt className="text-zinc-400">Tips</dt>
              <dd className="tabular-nums">{formatUsd(team.tipsGross)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-zinc-400">By day</p>
        <DailySalesChart daily={team.daily} className="mt-1 h-[160px]" />
      </div>
    </section>
  );
}
