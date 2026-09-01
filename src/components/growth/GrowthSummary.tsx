'use client';

import { useMemo } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  RANGE_LABEL,
  deltaFor,
  formatCount,
  formatDelta,
  formatPercent,
  type DayMap,
  type GrowthRange,
} from '@/lib/growth/metrics';
import { PlatformIcon } from './growthUi';
import type { GrowthAccount } from '@/types/firestore';

/**
 * The three facts worth having above the chart, on the house widget pattern
 * (DESIGN.md §5 Signature Component): a label, one Display-step number, and a
 * quiet supporting line.
 *
 * Each tile is written to be honest about incomplete data rather than to always
 * show a number. Reach is summed from every account's most recent reading and
 * says how many accounts it could not include; the movers say "not enough
 * readings yet" instead of ranking a single data point against nothing.
 */

interface GrowthSummaryProps {
  accounts: GrowthAccount[];
  seriesById: Map<string, DayMap>;
  from: string | null;
  range: GrowthRange;
}

export function GrowthSummary({ accounts, seriesById, from, range }: GrowthSummaryProps) {
  const summary = useMemo(() => {
    const withDelta = accounts.map((account) => ({
      account,
      delta: deltaFor(seriesById.get(account.id) ?? {}, from),
    }));

    const measured = withDelta.filter((d) => d.delta.last !== null);
    const reach = measured.reduce((sum, d) => sum + (d.delta.last ?? 0), 0);

    const comparable = withDelta.filter((d) => d.delta.change !== null);
    // Ranked by absolute followers gained, not by percentage: a 3% rise on a
    // 684k page is the bigger event of the week, and a percentage leaderboard
    // would be permanently topped by whichever account is smallest.
    const ranked = [...comparable].sort((a, b) => (b.delta.change ?? 0) - (a.delta.change ?? 0));
    const netChange = comparable.reduce((sum, d) => sum + (d.delta.change ?? 0), 0);
    const netBase = comparable.reduce((sum, d) => sum + (d.delta.first ?? 0), 0);

    return {
      reach,
      reachMissing: accounts.length - measured.length,
      netChange: comparable.length > 0 ? netChange : null,
      netPercent: netBase > 0 ? (netChange / netBase) * 100 : null,
      top: ranked[0] ?? null,
      bottom: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    };
  }, [accounts, seriesById, from]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardDescription>Total reach</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">
            {formatCount(summary.reach)}
          </CardTitle>
          <p className="text-[11px] text-zinc-400">
            {accounts.length === 0
              ? 'No accounts tracked yet'
              : summary.reachMissing > 0
                ? `Across ${accounts.length - summary.reachMissing} of ${accounts.length} accounts · ${summary.reachMissing} awaiting a first reading`
                : `Across ${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
          </p>
        </CardHeader>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardDescription>Net growth · {RANGE_LABEL[range].toLowerCase()}</CardDescription>
          <CardTitle
            className={`text-2xl font-semibold tabular-nums ${
              summary.netChange === null ? 'text-zinc-400'
                : summary.netChange > 0 ? 'text-green-400'
                : summary.netChange < 0 ? 'text-red-400' : ''
            }`}
          >
            {summary.netChange === null ? '—' : formatDelta(summary.netChange)}
          </CardTitle>
          <p className="text-[11px] text-zinc-400">
            {summary.netChange === null
              ? 'Needs at least two readings'
              : summary.netPercent !== null
                ? `${formatPercent(summary.netPercent)} across the roster`
                : 'Followers gained across the roster'}
          </p>
        </CardHeader>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardDescription>Biggest mover</CardDescription>
          {summary.top ? (
            <>
              <CardTitle className="flex items-center gap-1.5 truncate text-2xl font-semibold">
                <PlatformIcon platform={summary.top.account.platform} className="size-4" />
                <span className="truncate">{summary.top.account.displayName}</span>
              </CardTitle>
              <p className="text-[11px] text-zinc-400">
                <span className={summary.top.delta.change! >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {formatDelta(summary.top.delta.change!)}
                </span>
                {summary.bottom && summary.bottom.account.id !== summary.top.account.id && (
                  <> · slowest {summary.bottom.account.displayName}{' '}
                    <span className={summary.bottom.delta.change! >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {formatDelta(summary.bottom.delta.change!)}
                    </span>
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <CardTitle className="text-2xl font-semibold text-zinc-400">—</CardTitle>
              <p className="text-[11px] text-zinc-400">Not enough readings in this range yet</p>
            </>
          )}
        </CardHeader>
      </Card>
    </div>
  );
}
