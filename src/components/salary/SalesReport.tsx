'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Loader2Icon, RotateCcw, Search, Trash2, Undo2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/components/AuthProvider';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { SyncStatus } from '@/components/buddyx/SyncStatus';
import {
  AttrChip,
  FanLabel,
  GROSS_NOTE,
  InfoTip,
  KpiTile,
  LegendSwatch,
  PPV_ATTRIBUTION,
  TIPS_ATTRIBUTION,
} from '@/components/buddyx/buddyxUi';
import { getCache, setCache } from '@/lib/queryCache';
import { formatUsd, pluralise, signedMoneyClass } from '@/lib/salary/salaryFormat';
import { HintedLabel, SALARY_DAY_HINT, SaleWhen } from './SalaryClock';
import { formatDayLabel, formatDayLabelWithWeekday, toDayKey } from '@/lib/salary/salaryDate';
import { SALARY_TZ_OFFSET_MINUTES, SALES_CUTOVER_AT } from '@/lib/salary/salaryConstants';
import { saleTypeLabel } from '@/lib/salary/saleTypes';
import { SALE_KIND_COLORS } from '@/lib/buddyx/chartColors';
import type { SalarySale } from '@/lib/salary/salaryTypes';

/** When BuddyX took over from the Infloww export, in the salary clock — from the one constant, not retyped. */
const CUTOVER_LABEL = (() => {
  const local = new Date(SALES_CUTOVER_AT + SALARY_TZ_OFFSET_MINUTES * 60_000);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} on ${formatDayLabel(toDayKey(SALES_CUTOVER_AT))} ${local.getUTCFullYear()}`;
})();

/**
 * Every individual sale behind a month's figures — **breakdown first**.
 *
 * An agent mid-month, between chats, asks "what am I being credited for, and is
 * it right?". So the month leads: tips and PPV (each carrying the sentence that
 * says how it is attributed), the daily split, where it came from. The ledger
 * follows, because a missing tip is found by narrowing to a day and a creator,
 * and then it is a dispute away.
 *
 * Reversals are shown, not hidden, in status red with a negative amount. A
 * refund the agent cannot see is a figure they cannot reconcile. Sales a
 * dispute moved away from the agent are listed at the foot, each naming the
 * dispute — what left their month, and why.
 */

/** Matches `useSalaryMonth`: an agent who has just been told a figure changed
 *  expects the next screen to agree with them, so stale sales are worse than a
 *  second request. Long enough to cover flicking between the three tabs, which
 *  Radix unmounts and so re-fetched in full every single time. */
const CACHE_TTL_MS = 60 * 1000;

/** Rows rendered before the "show the rest" step. A busy month runs to hundreds
 *  of sales; nobody reads past the first screenful without filtering, and the
 *  filters are right above the table. */
const INITIAL_ROWS = 150;

interface Sum {
  gross: number;
  count: number;
}

interface SalesReportResponse {
  sales: SalarySale[];
  names: Record<string, string>;
  totals: { gross: number; net: number; count: number; reversals: number };
  byKind: { tip: Sum & { net: number }; ppv: Sum & { net: number } };
  byCreator: Array<Sum & { creatorId: string | null; name: string }>;
  byType: Array<Sum & { name: string }>;
  byDay: Array<{ day: string; tips: number; ppv: number }>;
  transferredAway: SalarySale[];
  transfers: { inGross: number; inCount: number; outGross: number; outCount: number };
  finalized: boolean;
  spansCutover: boolean;
}

interface SalesReportProps {
  month: string;
  userId?: string | null;
  timezone: string;
  /** Restricts the ledger to a single day and shows a way back to the month. */
  day?: string | null;
  onClearDay?: () => void;
  /** A bar in the daily chart was clicked — reuse the page's inspected-day state. */
  onSelectDay?: (day: string) => void;
  /** Payroll only — lets an admin remove an Infloww row a later export retracted. */
  allowDelete?: boolean;
  onDeleted?: () => void;
}

const kindChartConfig = {
  tips: { label: 'Tips', color: SALE_KIND_COLORS.tip },
  ppv: { label: 'PPV', color: SALE_KIND_COLORS.ppv },
} satisfies ChartConfig;

const shortDay = (day: string) => `${Number(day.slice(8, 10))}`;

/** Clears both caches' worth of this report — used after a write elsewhere. */
export function salesReportCacheKey(viewerUid: string, subjectUid: string, month: string): string {
  return `bluu_salary_sales_v2:${viewerUid}:${subjectUid}:${month}`;
}

export function SalesReport({
  month,
  userId,
  timezone,
  day = null,
  onClearDay,
  onSelectDay,
  allowDelete = false,
  onDeleted,
}: SalesReportProps) {
  const { user } = useAuth();
  const [data, setData] = useState<SalesReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [creator, setCreator] = useState('all');
  const [type, setType] = useState('all');

  // The whole month is fetched once and the day is a filter on it, so picking
  // a bar costs nothing and the breakdown above the ledger stays the month's.
  const load = useCallback(async (force = false) => {
    if (!user) return;

    const key = salesReportCacheKey(user.uid, userId ?? user.uid, month);
    if (!force) {
      const cached = getCache<SalesReportResponse>(key, CACHE_TTL_MS);
      if (cached) {
        setData(cached);
        setLoading(false);
        setError(null);
        return;
      }
    }

    // A forced refresh keeps the figures on screen (stale is not empty); a new
    // month or agent clears them, so one month's rows never sit under another's label.
    if (!force) {
      setData(null);
      setLoading(true);
    }
    setError(null);

    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ month });
      if (userId) params.set('userId', userId);

      const res = await fetch(`/api/ca-salary/sales?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let message = `Could not load sales (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        throw new Error(message);
      }

      const body = (await res.json()) as SalesReportResponse;
      setCache(key, body);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sales');
    } finally {
      setLoading(false);
    }
  }, [user, month, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const deferredQuery = useDeferredValue(query);
  const [showAllRows, setShowAllRows] = useState(false);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = deferredQuery.trim().toLowerCase();
    return data.sales.filter(sale => {
      if (day && sale.day !== day) return false;
      if (creator !== 'all' && (sale.creatorId ?? `name:${sale.creatorName}`) !== creator) return false;
      if (type !== 'all' && sale.type !== type) return false;
      if (!needle) return true;
      return (
        sale.fanName.toLowerCase().includes(needle) ||
        sale.fanId.includes(needle) ||
        sale.creatorName.toLowerCase().includes(needle)
      );
    });
  }, [data, deferredQuery, creator, type, day]);

  const filtersActive = deferredQuery.trim() !== '' || creator !== 'all' || type !== 'all';
  const filteredGross = filtered.reduce((sum, sale) => sum + sale.signedGross, 0);
  const visible = showAllRows ? filtered : filtered.slice(0, INITIAL_ROWS);
  const hiddenRows = filtered.length - visible.length;
  const clearFilters = () => {
    setQuery('');
    setCreator('all');
    setType('all');
  };

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[92px] rounded-xl" />)}
        </div>
        <Skeleton className="h-[220px] w-full rounded-xl" />
        <Skeleton className="h-[320px] w-full rounded-lg" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-400">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load(true)}>
          <RotateCcw className="size-3.5" aria-hidden />
          Try again
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const daySales = day ? data.sales.filter(s => s.day === day) : data.sales;
  const creatorLabel = (row: { creatorId: string | null; name: string }) =>
    row.creatorId ? <CreatorChip creatorId={row.creatorId} name={row.name || undefined} size="xs" /> : <span>{row.name || '—'}</span>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {data.finalized && <AttrChip>Finalised — figures frozen</AttrChip>}
        </div>
        <SyncStatus scope="sales" onSynced={() => void load(true)} />
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Tips"
          basis="gross"
          tip={TIPS_ATTRIBUTION}
          value={formatUsd(data.byKind.tip.gross)}
          meta={`${pluralise(data.byKind.tip.count, 'tip')} · ${formatUsd(data.byKind.tip.net)} net`}
        />
        <KpiTile
          label="PPV"
          basis="gross"
          tip={PPV_ATTRIBUTION}
          value={formatUsd(data.byKind.ppv.gross)}
          meta={`${pluralise(data.byKind.ppv.count, 'PPV')} · ${formatUsd(data.byKind.ppv.net)} net`}
        />
        <KpiTile
          label="Total"
          basis="gross"
          tip={GROSS_NOTE}
          value={formatUsd(data.totals.gross)}
          meta={`${pluralise(data.totals.count, 'sale')} · ${formatUsd(data.totals.net)} net after the platform's share`}
        />
        <KpiTile
          label="Transfers"
          basis="gross"
          value={
            data.transfers.inCount + data.transfers.outCount === 0
              ? '—'
              : `+${formatUsd(data.transfers.inGross)} / −${formatUsd(data.transfers.outGross)}`
          }
          meta={
            data.transfers.inCount + data.transfers.outCount === 0
              ? 'No disputes moved a sale'
              : `${data.transfers.inCount} in · ${data.transfers.outCount} out`
          }
          href={data.transfers.outCount > 0 ? '#transferred-away' : undefined}
        />
      </div>

      {/* ── Daily chart ── */}
      {data.byDay.length > 0 && (
        <section className={cn('rounded-xl p-4', SURFACE)} aria-labelledby="daily-sales-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="daily-sales-title" className="text-sm font-semibold">Gross sales by day</h2>
            <div className="flex items-center gap-3 text-xs text-zinc-300">
              <span className="inline-flex items-center gap-1.5">
                <LegendSwatch color={SALE_KIND_COLORS.tip} /> Tips <InfoTip text={TIPS_ATTRIBUTION} />
              </span>
              <span className="inline-flex items-center gap-1.5">
                <LegendSwatch color={SALE_KIND_COLORS.ppv} /> PPV <InfoTip text={PPV_ATTRIBUTION} />
              </span>
            </div>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Gross per salary day (SAST) <InfoTip text={SALARY_DAY_HINT} className="inline-flex align-[-2px]" />
            {onSelectDay ? ' Select a day to see its sales below.' : ''}
          </p>
          <ChartContainer config={kindChartConfig} className="mt-3 h-[200px] w-full">
            <BarChart
              data={data.byDay}
              margin={{ left: 4, right: 8, top: 8 }}
              onClick={state => {
                const d = (state as { activeLabel?: string } | undefined)?.activeLabel;
                if (d && onSelectDay) onSelectDay(String(d));
              }}
              className={onSelectDay ? 'cursor-pointer' : undefined}
            >
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} tickFormatter={shortDay} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} width={48} tickFormatter={v => `$${v}`} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={label => formatDayLabelWithWeekday(String(label))}
                    formatter={(value, name) => [` ${formatUsd(Number(value))}`, name === 'tips' ? 'Tips' : 'PPV']}
                  />
                }
              />
              <Bar dataKey="tips" stackId="kind" fill="var(--color-tips)" stroke="var(--card)" strokeWidth={2} />
              <Bar dataKey="ppv" stackId="kind" fill="var(--color-ppv)" stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </section>
      )}

      {/* ── Where it came from ── */}
      {data.sales.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <BreakdownList
            title="By creator · gross"
            rows={data.byCreator.map(r => ({ key: r.creatorId ?? `name:${r.name}`, label: creatorLabel(r), gross: r.gross }))}
          />
          <BreakdownList
            title="By type · gross"
            rows={data.byType.map(r => ({ key: r.name, label: <span>{saleTypeLabel(r.name)}</span>, gross: r.gross }))}
          />
        </div>
      )}

      {day && <DayBanner day={day} onClear={onClearDay} />}

      {data.sales.length === 0 ? (
        <p className="text-sm text-zinc-400">No sales recorded for this month yet.</p>
      ) : (
        <>
          {/* ── Ledger ── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search fan, ID or creator"
                className="h-8 pl-8"
                aria-label="Search sales"
              />
            </div>

            <Select value={creator} onValueChange={setCreator}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Creator" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All creators</SelectItem>
                {data.byCreator.map(row => (
                  <SelectItem key={row.creatorId ?? `name:${row.name}`} value={row.creatorId ?? `name:${row.name}`}>
                    {row.name || '—'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={type} onValueChange={setType}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {data.byType.map(row => (
                  <SelectItem key={row.name} value={row.name}>
                    {saleTypeLabel(row.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SalesTable
            rows={visible}
            names={data.names}
            timezone={timezone}
            showSource={data.spansCutover}
            renderAction={
              allowDelete
                ? sale =>
                    sale.source === 'infloww' ? (
                      <DeleteSaleButton saleId={sale.saleId} onDeleted={() => { void load(true); onDeleted?.(); }} />
                    ) : null
                : undefined
            }
          />

          {data.spansCutover && (
            <p className="text-[11px] text-zinc-400">
              Sales before {CUTOVER_LABEL} (salary time) came from Infloww; later sales come from BuddyX.
            </p>
          )}

          {hiddenRows > 0 && (
            <button
              type="button"
              onClick={() => setShowAllRows(true)}
              className="rounded-sm text-sm text-foreground underline underline-offset-2 transition-colors duration-[120ms] hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Show the remaining {pluralise(hiddenRows, 'sale')}
            </button>
          )}

          {/* The foot states the truth it has — the filtered total when filtered,
              the real one otherwise. A count with no way out of an empty filter
              is a dead end (DESIGN.md §5). */}
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-400">
              {day && !filtersActive ? (
                <>No sales on {formatDayLabelWithWeekday(day)}. </>
              ) : (
                <>Nothing matches these filters. </>
              )}
              <button
                type="button"
                onClick={filtersActive ? clearFilters : onClearDay}
                className="rounded-sm text-foreground underline underline-offset-2 transition-colors duration-[120ms] hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {filtersActive ? `Clear them to see all ${pluralise(daySales.length, 'sale')}.` : 'See the whole month.'}
              </button>
            </p>
          ) : (
            <p className="text-sm text-zinc-400">
              {filtersActive ? (
                <>
                  Showing {filtered.length} of {pluralise(daySales.length, 'sale')} ·{' '}
                  <span className="tabular-nums text-foreground">{formatUsd(filteredGross)}</span> gross{' '}
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-sm text-foreground underline underline-offset-2 transition-colors duration-[120ms] hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  {pluralise(filtered.length, 'sale')} ·{' '}
                  <span className="tabular-nums text-foreground">{formatUsd(filteredGross)}</span> gross
                  {data.totals.reversals > 0 && !day && <> · {pluralise(data.totals.reversals, 'reversal')} deducted</>}
                </>
              )}
            </p>
          )}
        </>
      )}

      {/* ── What left this month ── */}
      {data.transferredAway.length > 0 && (
        <section id="transferred-away" className="space-y-2 pt-2" aria-labelledby="transferred-away-title">
          <h2 id="transferred-away-title" className="text-sm font-semibold">Transferred away</h2>
          <p className="text-[11px] text-zinc-400">
            Sales an approved dispute moved to another agent. They no longer count toward this month.
          </p>
          <SalesTable rows={data.transferredAway} names={data.names} timezone={timezone} showSource={false} away />
        </section>
      )}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────


const SALES_COLUMNS: Array<{ label: string; hint?: string }> = [
  {
    label: 'When',
    hint: 'In your own timezone. Pay counts each sale on its SAST day, so a late-night sale can show a different date — hover a time for both.',
  },
  { label: 'Creator' },
  { label: 'Type' },
  { label: 'Fan' },
  { label: 'Gross' },
];

function SalesTable({
  rows,
  names,
  timezone,
  showSource,
  away = false,
  renderAction,
}: {
  rows: SalarySale[];
  names: Record<string, string>;
  timezone: string;
  showSource: boolean;
  away?: boolean;
  renderAction?: (sale: SalarySale) => React.ReactNode;
}) {
  return (
    // Focusable and named: a region that scrolls only under a pointer is a
    // WCAG 2.1.1 failure.
    <div
      tabIndex={0}
      role="region"
      aria-label={away ? 'Sales transferred away, scrollable' : 'Individual sales, scrollable'}
      className="overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/[0.07]">
            {SALES_COLUMNS.map(({ label, hint }, index) => (
              <th
                key={label}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400',
                  index === 4 ? 'text-right' : 'text-left',
                )}
              >
                {hint ? <HintedLabel label={label} hint={hint} /> : label}
              </th>
            ))}
            {renderAction && <th scope="col" className="w-10 px-3 py-2.5"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.045]">
          {rows.map(sale => (
            <tr key={sale.saleId} className={cn(sale.status === 'reverse' && 'bg-red-500/[0.04]')}>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-400">
                <SaleWhen occurredAt={sale.occurredAt} day={sale.day} timezone={timezone} />
              </td>
              <td className="px-3 py-2">
                {sale.creatorId ? (
                  <CreatorChip creatorId={sale.creatorId} name={sale.creatorName || undefined} size="xs" />
                ) : (
                  sale.creatorName || '—'
                )}
              </td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  <AttrChip>{saleTypeLabel(sale.type)}</AttrChip>
                  {showSource && <AttrChip>{sale.source === 'buddyx' ? 'BuddyX' : 'Infloww'}</AttrChip>}
                  {sale.status === 'reverse' && (
                    <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-400">Reversed</span>
                  )}
                  {!away && sale.transfer && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-300">
                      <ArrowDownLeft className="size-3" aria-hidden />
                      Transferred in
                      {sale.transfer.fromUserId ? ` from ${names[sale.transfer.fromUserId] ?? 'another agent'}` : ''}
                    </span>
                  )}
                  {away && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-300">
                      <ArrowUpRight className="size-3" aria-hidden />
                      Moved to {sale.userId ? names[sale.userId] ?? 'another agent' : 'another agent'}
                    </span>
                  )}
                  {!away && sale.disputeId && <span className="text-[11px] text-zinc-300">Disputed</span>}
                </span>
              </td>
              <td className="max-w-[14rem] px-3 py-2">
                <FanLabel name={sale.fanName} fanId={sale.fanId} className="block" />
              </td>
              <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', away ? 'text-zinc-400 line-through' : signedMoneyClass(sale.signedGross))}>
                {formatUsd(sale.signedGross)}
              </td>
              {renderAction && <td className="px-1 py-1 text-right">{renderAction(sale)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayBanner({ day, onClear }: { day: string; onClear?: () => void }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-lg px-3 py-2', SURFACE)}>
      <p className="text-sm">
        Sales on <span className="font-medium">{formatDayLabelWithWeekday(day)}</span>{' '}
        <span className="text-zinc-400">(SAST salary day)</span>{' '}
        <InfoTip text={SALARY_DAY_HINT} className="inline-flex align-[-2px]" />
      </p>
      {onClear && (
        <Button size="xs" variant="ghost" onClick={onClear} className="text-zinc-400">
          <Undo2 className="size-3.5" aria-hidden />
          Whole month
        </Button>
      )}
    </div>
  );
}

function BreakdownList({ title, rows }: { title: string; rows: Array<{ key: string; label: React.ReactNode; gross: number }> }) {
  const max = Math.max(...rows.map(r => Math.abs(r.gross)), 1);

  return (
    <div className={cn('rounded-lg p-3', SURFACE)}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      <ul className="mt-2.5 space-y-1.5">
        {rows.slice(0, 6).map(row => (
          <li key={row.key} className="relative">
            {/* The bar sits behind the row rather than beside it, so the label
                keeps its full width and the magnitude still reads at a glance. */}
            <span
              className="absolute inset-y-0 left-0 rounded-sm bg-action-blue/[0.12]"
              style={{ width: `${(Math.abs(row.gross) / max) * 100}%` }}
              aria-hidden
            />
            <span className="relative flex items-center justify-between gap-3 px-1.5 py-1 text-sm">
              <span className="min-w-0 truncate">{row.label}</span>
              <span className={cn('shrink-0 tabular-nums', signedMoneyClass(row.gross))}>{formatUsd(row.gross)}</span>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 6 && <p className="mt-2 px-1.5 text-xs text-zinc-400">+{rows.length - 6} more</p>}
    </div>
  );
}

/**
 * Removing an Infloww sale is destructive and changes a payout, so it confirms.
 * BuddyX rows have no delete — the sync owns them, and a wrongly-held one is a
 * dispute.
 */
function DeleteSaleButton({ saleId, onDeleted }: { saleId: string; onDeleted: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/ca-salary/sales?saleId=${encodeURIComponent(saleId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let message = `Could not remove the sale (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        setError(message);
        return;
      }
      setOpen(false);
      toast.success('Sale removed');
      onDeleted();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-zinc-400 transition-colors duration-[120ms] hover:text-red-400"
          aria-label="Remove this sale"
        >
          <Trash2 aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this sale?</AlertDialogTitle>
          <AlertDialogDescription>
            It stops counting toward the agent&apos;s gross and commission straight away. Re-importing an Infloww
            export that still contains this row will bring it back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={event => {
              event.preventDefault();
              void remove();
            }}
          >
            {busy && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { SalesTable as SalesLedgerTable };
