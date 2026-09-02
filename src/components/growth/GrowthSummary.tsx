'use client';

import { memo, useMemo } from 'react';
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
import { AccountIdentity, DeltaValue } from './growthUi';
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
 *
 * **Fastest Growing and Slowest are the same metric, read from both ends** —
 * `ranked` sorted by followers gained, so they are `[0]` and `[last]` of one
 * list. The tile previously called this "Biggest Mover", which named neither
 * end and invited the reading that it ranked by follower *count*. It never did.
 *
 * The ranking is by **absolute** followers gained, so in a period where every
 * account shrank, "fastest growing" is the one that shrank least and its figure
 * renders red and negative. The number carries that; the label cannot.
 *
 * **This tile's Display step is an account, not a figure** — the deliberate
 * exception to the row. Its two siblings answer "how many"; this one answers
 * "who", and promoting the delta to match their shape buries the only thing it
 * exists to name. The figures stay subordinate on both rows.
 */

interface GrowthSummaryProps {
  accounts: GrowthAccount[];
  seriesById: Map<string, DayMap>;
  from: string | null;
  range: GrowthRange;
}

/**
 * Memoised: none of these tiles depend on the highlight, and the highlight
 * changes on every row and line the cursor crosses.
 */
export const GrowthSummary = memo(function GrowthSummary({
  accounts, seriesById, from, range,
}: GrowthSummaryProps) {
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
          <CardDescription>Total Followers</CardDescription>
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
          <CardDescription>Net Growth · {RANGE_LABEL[range].toLowerCase()}</CardDescription>
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
          <CardDescription>Fastest Growing · {RANGE_LABEL[range].toLowerCase()}</CardDescription>
          {summary.top ? (
            <>
              {/* The ACCOUNT is the Display step here, not the number. This tile
                  answers "who", where its two siblings answer "how many" — so
                  matching their shape by promoting the delta buries the one
                  thing the tile exists to name. The figure rides along after it,
                  small enough not to compete. */}
              <CardTitle className="flex items-center gap-2 text-2xl font-semibold">
                <AccountIdentity account={summary.top.account} avatarClassName="size-5" />
                <span className="min-w-0 flex-1 truncate">{summary.top.account.handle}</span>
                <DeltaValue
                  delta={summary.top.delta}
                  showPercent={false}
                  className="shrink-0 text-sm font-medium"
                />
              </CardTitle>
              {summary.bottom && summary.bottom.account.id !== summary.top.account.id ? (
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span className="shrink-0">Slowest</span>
                  <AccountIdentity
                    account={summary.bottom.account}
                    avatarClassName="size-4"
                    iconClassName="size-3"
                  />
                  <span className="min-w-0 flex-1 truncate text-zinc-300">
                    {summary.bottom.account.handle}
                  </span>
                  <DeltaValue delta={summary.bottom.delta} showPercent={false} className="shrink-0" />
                </div>
              ) : (
                // One comparable account is not a ranking. Saying so beats an
                // empty second line, which reads as a value that failed to load.
                <p className="text-[11px] text-zinc-400">Only one account has enough readings to rank</p>
              )}
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
});
