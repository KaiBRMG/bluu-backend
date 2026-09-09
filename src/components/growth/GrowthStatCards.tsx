'use client';

import { memo, useMemo } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PLATFORM_LABEL, type GrowthPlatform } from '@/lib/growth/platform';
import { formatCount } from '@/lib/growth/metrics';
import type { GrowthAccount } from '@/types/firestore';

/**
 * The four numbers that describe the whole operation, on the house widget
 * pattern (DESIGN.md §5): a label, one Display-step figure, one quiet line under
 * it.
 *
 * ── Why these are roster-wide and range-independent ─────────────────────────
 * Everything else on the page answers "over the window I picked, filtered to the
 * accounts I picked". These four deliberately do not: they are the standing
 * facts — how much reach exists, how much is being watched, and how much is
 * moving — and they are what the reader checks *before* choosing a filter. Two
 * tiles whose meaning changed with the chips above them would make the same
 * glance mean something different every time.
 *
 * ── Why they split by platform ──────────────────────────────────────────────
 * One combined follower total would be a number nobody can act on: an X follower
 * and a Facebook page follower are not the same unit, the two platforms are
 * scraped by different actors on different bills, and the roster is managed as
 * two lists. Summing them would produce a headline figure whose only honest use
 * is going up.
 *
 * Every total is built from each account's **most recent reading**, and says how
 * many accounts it could not include. An account awaiting its first scrape
 * contributes nothing rather than a zero — the difference between "this page has
 * no followers" and "we have not looked yet" is the whole reason the tile states
 * its coverage.
 */
export const GrowthStatCards = memo(function GrowthStatCards({
  accounts,
  postCount,
  signalCount,
  threshold,
}: {
  accounts: GrowthAccount[];
  /** Tracked X posts across the whole roster. */
  postCount: number;
  signalCount: number;
  threshold: number;
}) {
  const totals = useMemo(() => {
    const byPlatform: Record<GrowthPlatform, { followers: number; measured: number; total: number }> = {
      facebook: { followers: 0, measured: 0, total: 0 },
      twitter: { followers: 0, measured: 0, total: 0 },
    };
    for (const account of accounts) {
      const bucket = byPlatform[account.platform];
      bucket.total += 1;
      // `latest` is the denormalized reading on the account document, so this
      // costs no series walk — but it is absent until the first successful
      // scrape, which is exactly the case the coverage line reports.
      if (account.latest) {
        bucket.followers += account.latest.followers;
        bucket.measured += 1;
      }
    }
    return byPlatform;
  }, [accounts]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {(['twitter', 'facebook'] as const).map((platform) => {
        const bucket = totals[platform];
        return (
          <Card key={platform} className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardDescription>{PLATFORM_LABEL[platform]} Followers</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">
                {bucket.measured === 0 ? '—' : formatCount(bucket.followers)}
              </CardTitle>
              <p className="text-[11px] text-zinc-400">
                {bucket.total === 0
                  ? `No ${PLATFORM_LABEL[platform]} accounts tracked`
                  : bucket.measured < bucket.total
                    ? `Across ${bucket.measured} of ${bucket.total} accounts · ${bucket.total - bucket.measured} awaiting a first reading`
                    : `Across ${bucket.total} account${bucket.total === 1 ? '' : 's'}`}
              </p>
            </CardHeader>
          </Card>
        );
      })}

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardDescription>Posts Tracked</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{postCount}</CardTitle>
          <p className="text-[11px] text-zinc-400">
            {postCount === 0
              ? 'Paste an X post link on an account to start'
              : 'On X — engagement read on a schedule'}
          </p>
        </CardHeader>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardDescription>Active Signals</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{signalCount}</CardTitle>
          {/* Orange is the app's attention-needed hue, and a signal is exactly
              that. At zero the line goes back to Ink Secondary — a permanently
              coloured tile is a coloured tile nobody reads. */}
          <p className={`text-[11px] ${signalCount > 0 ? 'text-orange-400' : 'text-zinc-400'}`}>
            {signalCount > 0
              ? `Growing over ${threshold}% this week`
              : `Nothing over ${threshold}% this week`}
          </p>
        </CardHeader>
      </Card>
    </div>
  );
});
