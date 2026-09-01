'use client';

import { memo, useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  deltaFor,
  formatCount,
  sparklineFor,
  type DayMap,
  type GrowthDelta,
  type SeriesPoint,
} from '@/lib/growth/metrics';
import { DeltaValue, PlatformIcon } from './growthUi';
import { Sparkline } from './Sparkline';
import type { GrowthAccount } from '@/types/firestore';

type SortKey = 'name' | 'followers' | 'change' | 'percent';

/**
 * The leaderboard is the page's reading surface; the chart above it is the
 * shape. It is also the chart's legend — hovering a row lifts that account's
 * trace out of the greyscale field, which is how a name gets attached to a line
 * without printing twelve swatches.
 *
 * Opening a row shows a detail sheet in place rather than navigating, so the
 * affordance is a button — but the button is the **account name inside the first
 * cell**, not the `<tr>`. Giving the row `role="button"` overrides `row` and
 * orphans its cells: the column associations the sortable headers exist to
 * provide disappear, and the whole row announces as one flat label. The row keeps
 * its click handler for the mouse; the keyboard travels through the name button,
 * which is also where the focus ring lives — a `box-shadow` ring on a `<tr>`
 * is not painted at all under `border-collapse: collapse`, which Tailwind's
 * preflight sets on every table.
 *
 * Rows are transparent on the canvas, so they take the overlay hover steps
 * rather than `brightness` (DESIGN.md § Interaction).
 */

interface GrowthLeaderboardProps {
  accounts: GrowthAccount[];
  seriesById: Map<string, DayMap>;
  from: string | null;
  highlightId: string | null;
  onHighlight: (id: string | null) => void;
  onOpen: (account: GrowthAccount) => void;
}

export function GrowthLeaderboard({
  accounts, seriesById, from, highlightId, onHighlight, onOpen,
}: GrowthLeaderboardProps) {
  const [sort, setSort] = useState<SortKey>('change');
  const [ascending, setAscending] = useState(false);

  const rows = useMemo(() => {
    const mapped = accounts.map((account) => {
      const days = seriesById.get(account.id) ?? {};
      return { account, delta: deltaFor(days, from), spark: sparklineFor(days, from) };
    });

    const direction = ascending ? 1 : -1;
    return mapped.sort((a, b) => {
      if (sort === 'name') return a.account.displayName.localeCompare(b.account.displayName) * direction;
      // Accounts with nothing to compare sink to the bottom in either direction —
      // they are not "the worst performer", they are unmeasured.
      const value = (d: GrowthDelta) =>
        sort === 'followers' ? d.last : sort === 'percent' ? d.percent : d.change;
      const av = value(a.delta);
      const bv = value(b.delta);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * direction;
    });
  }, [accounts, seriesById, from, sort, ascending]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setAscending((v) => !v);
    else { setSort(key); setAscending(key === 'name'); }
  };

  if (accounts.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <SortHead label="Account" active={sort === 'name'} ascending={ascending} onClick={() => toggleSort('name')} />
          <SortHead label="Followers" align="right" active={sort === 'followers'} ascending={ascending} onClick={() => toggleSort('followers')} />
          <SortHead label="Change" align="right" active={sort === 'change'} ascending={ascending} onClick={() => toggleSort('change')} />
          <TableHead className="w-[110px] text-right">Trend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ account, delta, spark }) => (
          <LeaderboardRow
            key={account.id}
            account={account}
            delta={delta}
            spark={spark}
            isHighlighted={account.id === highlightId}
            onHighlight={onHighlight}
            onOpen={onOpen}
          />
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Memoised because the highlight lives on the page: a mouse sweep down the
 * table would otherwise re-render and re-path every sparkline in the body on
 * each row entered, when only two rows have actually changed.
 */
const LeaderboardRow = memo(function LeaderboardRow({
  account, delta, spark, isHighlighted, onHighlight, onOpen,
}: {
  account: GrowthAccount;
  delta: GrowthDelta;
  spark: SeriesPoint[];
  isHighlighted: boolean;
  onHighlight: (id: string | null) => void;
  onOpen: (account: GrowthAccount) => void;
}) {
  return (
    <TableRow
      // Hovering a row is how the chart's field resolves into one named line, so
      // the highlight is driven from here as well as the chart.
      onMouseEnter={() => onHighlight(account.id)}
      onMouseLeave={() => onHighlight(null)}
      onClick={() => onOpen(account)}
      className={`cursor-pointer transition-colors ${
        isHighlighted ? 'bg-[#3b82f6]/15' : 'hover:bg-white/[0.055] active:bg-white/[0.08]'
      }`}
    >
      <TableCell className="max-w-0">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={account.platform} />
          <button
            type="button"
            // The row already handles the mouse; letting this bubble would open
            // the sheet twice.
            onClick={(e) => { e.stopPropagation(); onOpen(account); }}
            onFocus={() => onHighlight(account.id)}
            onBlur={() => onHighlight(null)}
            aria-label={`${account.displayName} — open details`}
            className={`truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:[--tw-ring-color:#3b82f6] ${
              isHighlighted ? 'font-semibold text-white' : 'font-medium text-zinc-300'
            }`}
          >
            {account.displayName}
          </button>
          {!account.isActive && (
            <span className="shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
              Stopped
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums text-zinc-300">
        {delta.last === null ? <span className="text-zinc-400">—</span> : formatCount(delta.last)}
      </TableCell>
      <TableCell className="text-right">
        <DeltaValue delta={delta} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end">
          <Sparkline points={spark} highlighted={isHighlighted} />
        </div>
      </TableCell>
    </TableRow>
  );
});

function SortHead({
  label, active, ascending, onClick, align = 'left',
}: {
  label: string;
  active: boolean;
  ascending: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    // aria-sort belongs to the column header, not to the control inside it —
    // the role that owns the property is `columnheader`, which is the <th>.
    <TableHead
      className={align === 'right' ? 'text-right' : undefined}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        // This project's TableHead inks `text-foreground`, so stepping to
        // zinc-300 on hover and when active made both states *dimmer* than rest.
        // Rest sits at Ink Secondary and both engaged states step up to white.
        className={`inline-flex items-center gap-1 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:[--tw-ring-color:#3b82f6] ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-white' : 'text-zinc-400'}`}
      >
        {label}
        {active && (ascending
          ? <ArrowUpIcon className="size-3" aria-hidden />
          : <ArrowDownIcon className="size-3" aria-hidden />)}
      </button>
    </TableHead>
  );
}
