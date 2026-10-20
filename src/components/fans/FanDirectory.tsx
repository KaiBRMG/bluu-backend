'use client';

import { useState } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BasisTag, LoadError, SEGMENT, fanReportHref } from '@/components/buddyx/buddyxUi';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { formatUsd, pluralise } from '@/lib/salary/salaryFormat';
import { daysAgo } from '@/lib/buddyx/analyticsFormat';
import type { FanDirectory as FanDirectoryData, FanDirectoryFilter, FanDirectoryRow, FanDirectorySort } from '@/lib/buddyx/analyticsTypes';

/**
 * Every fan in the viewer's scope — "find the one I need". One row per fan
 * with every creator folded together; the row opens the fan's report.
 *
 * Search matches a name, the start of an OnlyFans id, a handle, or a pasted
 * profile link. The filter chips carry their own counts (after the search),
 * so a chip never leads to an empty page without saying so first.
 */

const FILTERS: Array<{ value: FanDirectoryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'customs', label: 'Has customs' },
  { value: 'owes', label: 'Owes money' },
  { value: 'unnamed', label: 'No name' },
  { value: 'unmatched', label: 'Handle only' },
];
const SORTS: Array<{ value: FanDirectorySort; label: string }> = [
  { value: 'spend', label: 'Biggest spenders' },
  { value: 'recent', label: 'Most recent' },
  { value: 'customs', label: 'Most customs' },
  { value: 'name', label: 'Name' },
];
const PAGE_SIZE = 50;

export function FanDirectory({ creatorId }: { creatorId: string | null }) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const q = useDebouncedValue(input.trim(), 250);
  const [filter, setFilter] = useState<FanDirectoryFilter>('all');
  const [sort, setSort] = useState<FanDirectorySort>('spend');
  // The page belongs to one query: change the search, filter, sort or creator
  // and it falls back to page one without an extra render.
  const queryKey = `${q}|${filter}|${sort}|${creatorId ?? ''}`;
  const [pageState, setPageState] = useState({ key: queryKey, page: 0 });
  const page = pageState.key === queryKey ? pageState.page : 0;
  const setPage = (next: (p: number) => number) => setPageState({ key: queryKey, page: next(page) });

  const params = new URLSearchParams({ filter, sort, offset: String(page * PAGE_SIZE) });
  if (q) params.set('q', q);
  if (creatorId) params.set('creatorId', creatorId);
  const { data, loading, error, reload } = useBuddyxAnalytics<FanDirectoryData>(`/api/fans?${params}`);

  const pages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const filterLabel = FILTERS.find(f => f.value === filter)?.label ?? '';

  return (
    <section className="space-y-3" aria-label="All fans">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Search a name, OnlyFans id, handle or link"
            aria-label="Search fans"
            className="pl-8"
          />
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={v => v && setFilter(v as FanDirectoryFilter)} aria-label="Show">
          {FILTERS.map(f => (
            <ToggleGroupItem key={f.value} value={f.value} className={SEGMENT}>
              {f.label}
              {data && <span className="ml-1 tabular-nums opacity-80">{data.counts[f.value]}</span>}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select value={sort} onValueChange={v => setSort(v as FanDirectorySort)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading && !data ? (
        <div className="space-y-1.5">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-11 rounded-md" />)}
        </div>
      ) : error && !data ? (
        <LoadError error={error} onRetry={() => void reload(true)} />
      ) : data && data.rows.length === 0 ? (
        q || filter !== 'all' ? (
          <p className="text-sm text-zinc-400">
            No fans match{q ? ` “${q}”` : ''}{filter !== 'all' ? ` in ${filterLabel}` : ''}.{' '}
            <button
              type="button"
              onClick={() => {
                setInput('');
                setFilter('all');
              }}
              className="rounded-sm text-zinc-300 underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Clear the search and filter
            </button>
          </p>
        ) : (
          <p className="text-sm text-zinc-400">No fans yet for these creators.</p>
        )
      ) : data ? (
        <>
          <div tabIndex={0} role="region" aria-label="Fans, scrollable" className="overflow-x-auto rounded-xl border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-[11px] uppercase tracking-wide text-zinc-400">
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Fan</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Creators</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    <span className="inline-flex items-center gap-1.5">Lifetime spend <BasisTag basis="gross" /></span>
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Last purchase</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Customs</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Owed</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y divide-white/[0.045]', loading && 'opacity-60')}>
                {data.rows.map(row => (
                  <DirectoryRow key={row.fanKey} row={row} onOpen={() => router.push(fanReportHref(row.fanKey))} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-400">
            <span className="tabular-nums">
              {pages > 1
                ? `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + data.rows.length} of ${data.total.toLocaleString()}`
                : pluralise(data.total, 'fan')}
            </span>
            {pages > 1 && (
              <span className="flex gap-2">
                <Button size="xs" variant="outline" disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="xs" variant="outline" disabled={page + 1 >= pages || loading} onClick={() => setPage(p => p + 1)}>Next</Button>
              </span>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function DirectoryRow({ row, onOpen }: { row: FanDirectoryRow; onOpen: () => void }) {
  const identity = row.fanId ?? (row.handle ? `@${row.handle}` : row.fanKey);
  return (
    <tr onClick={onOpen} className="cursor-pointer hover:bg-white/[0.055] active:bg-white/[0.08]">
      <td className="max-w-[18rem] px-3 py-2">
        <Link
          href={fanReportHref(row.fanKey)}
          prefetch={false}
          onClick={e => e.stopPropagation()}
          className={cn(
            'block truncate rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            !row.name && 'font-mono text-xs text-zinc-300',
          )}
        >
          {row.name ?? identity}
        </Link>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
          {row.name && <span className="font-mono">{identity}</span>}
          {row.nameSource === 'manual' && <><span aria-hidden>·</span> named by hand</>}
          {!row.name && <span>No name yet</span>}
          {row.unmatched && <><span aria-hidden>·</span><span className="text-orange-400">handle only</span></>}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="flex flex-wrap items-center gap-1">
          {row.creatorIds.slice(0, 3).map(id => <CreatorChip key={id} creatorId={id} size="xs" />)}
          {row.creatorIds.length > 3 && <span className="text-[11px] text-zinc-400">+{row.creatorIds.length - 3}</span>}
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.fanId ? formatUsd(row.lifetimeSpend) : '—'}</td>
      <td className="px-3 py-2 text-right text-zinc-400">{row.lastPurchaseAt ? daysAgo(row.lastPurchaseAt) : '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">{row.customs || '—'}</td>
      <td className={cn('px-3 py-2 text-right tabular-nums', row.outstandingAmount > 0 ? 'text-red-400' : 'text-zinc-400')}>
        {row.outstandingAmount > 0 ? formatUsd(row.outstandingAmount) : '—'}
      </td>
    </tr>
  );
}
