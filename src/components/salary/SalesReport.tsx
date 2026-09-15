'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Loader2Icon, RotateCcw, Search, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { getCache, setCache } from '@/lib/queryCache';
import { formatSaleDateTime, formatUsd, pluralise, signedMoneyClass } from '@/lib/salary/salaryFormat';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import type { SalarySale } from '@/lib/salary/salaryTypes';

/**
 * Every individual sale behind a month's figures.
 *
 * The point of this screen is traceability: when an agent disputes a daily
 * total, the answer is a transaction, and they should be able to find it
 * themselves rather than asking. So the report defaults to the whole month,
 * filters by creator and type, and searches the fan name — which is how an agent
 * actually remembers a sale ("that was the big tip from Evan").
 *
 * Reversals are shown, not hidden, in status red with a negative amount. A
 * refund the agent cannot see is a figure they cannot reconcile.
 */

/** Matches `useSalaryMonth`: an agent who has just been told a figure changed
 *  expects the next screen to agree with them, so stale sales are worse than a
 *  second request. Long enough to cover flicking between the three tabs, which
 *  Radix unmounts and so re-fetched in full every single time. */
const CACHE_TTL_MS = 60 * 1000;

/** Rows rendered before the "show the rest" step. A busy month runs to hundreds
 *  of sales, each one mounting its own tooltip; nobody reads past the first
 *  screenful without filtering, and the filters are right above the table. */
const INITIAL_ROWS = 150;

interface SalesReportResponse {
  sales: SalarySale[];
  totals: { gross: number; count: number; reversals: number };
  byCreator: Array<{ name: string; gross: number; count: number }>;
  byType: Array<{ name: string; gross: number; count: number }>;
}

interface SalesReportProps {
  month: string;
  userId?: string | null;
  timezone: string;
  /** Restricts to a single day and shows a way back to the month. */
  day?: string | null;
  onClearDay?: () => void;
  /** Payroll only — lets an admin remove a row a later export retracted. */
  allowDelete?: boolean;
  onDeleted?: () => void;
}

export function SalesReport({
  month,
  userId,
  timezone,
  day = null,
  onClearDay,
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

  const load = useCallback(async (force = false) => {
    if (!user) return;

    const key = `bluu_salary_sales_v1:${user.uid}:${userId ?? user.uid}:${month}:${day ?? 'month'}`;
    if (!force) {
      const cached = getCache<SalesReportResponse>(key, CACHE_TTL_MS);
      if (cached) {
        setData(cached);
        setLoading(false);
        setError(null);
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ month });
      if (userId) params.set('userId', userId);
      if (day) params.set('day', day);

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
  }, [user, month, userId, day]);

  useEffect(() => {
    void load();
  }, [load]);

  // The input stays at whatever the user typed; the (potentially several
  // hundred row) table re-filters at React's convenience. Cheaper and more
  // honest than a timer, which would have to guess at a delay.
  const deferredQuery = useDeferredValue(query);
  const [showAllRows, setShowAllRows] = useState(false);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = deferredQuery.trim().toLowerCase();
    return data.sales.filter(sale => {
      if (creator !== 'all' && sale.creatorName !== creator) return false;
      if (type !== 'all' && sale.type !== type) return false;
      if (!needle) return true;
      return (
        sale.fanName.toLowerCase().includes(needle) ||
        sale.fanId.includes(needle) ||
        sale.creatorName.toLowerCase().includes(needle)
      );
    });
  }, [data, deferredQuery, creator, type]);

  const filtersActive = deferredQuery.trim() !== '' || creator !== 'all' || type !== 'all';
  const filteredGross = filtered.reduce((sum, sale) => sum + sale.signedGross, 0);
  const visible = showAllRows ? filtered : filtered.slice(0, INITIAL_ROWS);
  const hiddenRows = filtered.length - visible.length;

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-[380px] w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
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

  if (data.sales.length === 0) {
    return (
      <div className="space-y-3">
        {day && <DayBanner day={day} onClear={onClearDay} />}
        <p className="text-sm text-zinc-400">
          {day ? 'No sales recorded on this day.' : 'No sales have been imported for this month yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {day && <DayBanner day={day} onClear={onClearDay} />}

      {/* Where the month came from, before the transaction list. Two summaries
          rather than one chart: creator and type answer different questions and
          neither is improved by being drawn. */}
      {!day && (
        <div className="grid gap-3 sm:grid-cols-2">
          <BreakdownList title="By creator" rows={data.byCreator} />
          <BreakdownList title="By sale type" rows={data.byType} />
        </div>
      )}

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
              <SelectItem key={row.name} value={row.name}>
                {row.name}
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
                {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Focusable and named: a region that scrolls only under a pointer is a
          WCAG 2.1.1 failure. */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Individual sales, scrollable"
        className="overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/[0.07]">
              {['When', 'Creator', 'Fan', 'Type', 'Gross'].map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400',
                    index === 4 ? 'text-right' : 'text-left',
                  )}
                >
                  {label}
                </th>
              ))}
              {allowDelete && <th scope="col" className="w-10 px-3 py-2.5" />}
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.045]">
            {visible.map(sale => (
              <tr key={sale.saleId} className={cn(sale.status === 'reverse' && 'bg-red-500/[0.04]')}>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-400">
                  {formatSaleDateTime(sale.occurredAt, timezone)}
                </td>
                <td className="px-3 py-2">{sale.creatorName || '—'}</td>
                <td className="max-w-[14rem] px-3 py-2">
                  {sale.fanName ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          className="block truncate rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {sale.fanName}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">{sale.fanName}</TooltipContent>
                    </Tooltip>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-400">
                  {sale.type}
                  {sale.status === 'reverse' && (
                    <span className="ml-2 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-400">
                      Reversed
                    </span>
                  )}
                </td>
                <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', signedMoneyClass(sale.signedGross))}>
                  {formatUsd(sale.signedGross)}
                </td>
                {allowDelete && (
                  <td className="px-1 py-1 text-right">
                    <DeleteSaleButton saleId={sale.saleId} onDeleted={() => { void load(true); onDeleted?.(); }} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
          the real one otherwise. A count with no way out of an empty filter is a
          dead end (DESIGN.md §5). */}
      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Nothing matches these filters.{' '}
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setCreator('all');
              setType('all');
            }}
            className="rounded-sm text-foreground underline underline-offset-2 transition-colors duration-[120ms] hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Clear them to see all {pluralise(data.sales.length, 'sale')}.
          </button>
        </p>
      ) : (
        <p className="text-sm text-zinc-400">
          {filtersActive ? (
            <>
              Showing {filtered.length} of {pluralise(data.sales.length, 'sale')} ·{' '}
              <span className="tabular-nums text-foreground">{formatUsd(filteredGross)}</span> of{' '}
              <span className="tabular-nums">{formatUsd(data.totals.gross)}</span>{' '}
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCreator('all');
                  setType('all');
                }}
                className="rounded-sm text-foreground underline underline-offset-2 transition-colors duration-[120ms] hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Clear filters
              </button>
            </>
          ) : (
            <>
              {pluralise(data.sales.length, 'sale')} ·{' '}
              <span className="tabular-nums text-foreground">{formatUsd(data.totals.gross)}</span>
              {data.totals.reversals > 0 && (
                <> · {pluralise(data.totals.reversals, 'reversal')} deducted</>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function DayBanner({ day, onClear }: { day: string; onClear?: () => void }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-lg px-3 py-2', SURFACE)}>
      <p className="text-sm">
        Sales on <span className="font-medium">{formatDayLabelWithWeekday(day)}</span>
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

function BreakdownList({ title, rows }: { title: string; rows: Array<{ name: string; gross: number; count: number }> }) {
  const max = Math.max(...rows.map(r => Math.abs(r.gross)), 1);

  return (
    <div className={cn('rounded-lg p-3', SURFACE)}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      <ul className="mt-2.5 space-y-1.5">
        {rows.slice(0, 6).map(row => (
          <li key={row.name} className="relative">
            {/* The bar sits behind the row rather than beside it, so the label
                keeps its full width and the magnitude still reads at a glance. */}
            <span
              className="absolute inset-y-0 left-0 rounded-sm bg-action-blue/[0.12]"
              style={{ width: `${(Math.abs(row.gross) / max) * 100}%` }}
              aria-hidden
            />
            <span className="relative flex items-baseline justify-between gap-3 px-1.5 py-1 text-sm">
              <span className="min-w-0 truncate">{row.name || '—'}</span>
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
 * Removing a sale is destructive and changes a payout, so it confirms.
 *
 * An `AlertDialog` rather than the Undo-toast pattern used elsewhere in the app:
 * an undo needs somewhere to put the thing back, and a deleted sale's identity
 * is a content hash of data this screen no longer holds. Confirm-before is the
 * honest shape when there is no after.
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
            It stops counting toward the agent&apos;s gross and commission straight away. Re-importing an export that
            still contains this row will bring it back.
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
