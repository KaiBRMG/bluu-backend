'use client';

import { memo, useMemo } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountAvatar, PlatformIcon } from './growthUi';
import { PLATFORM_LABEL, type GrowthPlatform } from '@/lib/growth/platform';
import { formatCount, formatPercent, type DayMap } from '@/lib/growth/metrics';
import { SPIKE_WINDOW_DAYS, spikePercent } from '@/lib/growth/signals';
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
 *
 * ── The two named tiles ─────────────────────────────────────────────
 * The third and fourth tiles name an **account** rather than counting something,
 * which is why each keeps the Display-step figure on the metric and puts the
 * identity in the line beneath: the number is what the row of tiles is scanned
 * for, and four tiles whose big text is sometimes a handle and sometimes a
 * figure would not scan as a row at all.
 *
 * They answer two different questions that are easy to conflate:
 *
 *  - **Biggest Mover** — who is *largest*. A standing fact about the roster,
 *    computed from the same denormalized `latest` reading the totals use, and
 *    including stopped accounts for the same reason the totals do: their last
 *    reading is still a fact and still counts toward the operation's reach.
 *  - **Fastest Growing** — who is *moving*, over the fixed seven-day window
 *    `signals.ts` owns. Active accounts only, because a stopped account's last
 *    week is frozen history rather than news — the rule `signalsFor` already
 *    follows, and sharing `spikePercent` is what keeps this tile and the Signals
 *    band from ever disagreeing about who is growing.
 *
 * Both stay range-independent like the totals beside them: the window here is
 * the signal window, never the page's range control.
 */
export const GrowthStatCards = memo(function GrowthStatCards({
  accounts,
  seriesById,
}: {
  accounts: GrowthAccount[];
  /** The follower history, for the seven-day growth reading. */
  seriesById: ReadonlyMap<string, DayMap>;
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

  /** Largest by its most recent reading. Stopped accounts included — see above. */
  const biggest = useMemo(() => {
    let best: { account: GrowthAccount; followers: number } | null = null;
    for (const account of accounts) {
      if (!account.latest) continue;
      if (!best || account.latest.followers > best.followers) {
        best = { account, followers: account.latest.followers };
      }
    }
    return best;
  }, [accounts]);

  /**
   * Strongest seven-day growth. Only positive movement qualifies: on a week when
   * the whole roster slipped, the least-shrinking account is not "fastest
   * growing", and naming it as though it were is the kind of quietly false
   * headline this subsystem writes `—` for everywhere else.
   */
  const fastest = useMemo(() => {
    let best: { account: GrowthAccount; percent: number } | null = null;
    for (const account of accounts) {
      if (!account.isActive) continue;
      const percent = spikePercent(seriesById.get(account.id) ?? {});
      if (percent === null || percent <= 0) continue;
      if (!best || percent > best.percent) best = { account, percent };
    }
    return best;
  }, [accounts, seriesById]);

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
          <CardDescription>Biggest Mover</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">
            {biggest === null ? '—' : formatCount(biggest.followers)}
          </CardTitle>
          {biggest === null
            ? <p className="text-[11px] text-zinc-400">No account has been read yet</p>
            : <AccountLine account={biggest.account} />}
        </CardHeader>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardDescription>Fastest Growing</CardDescription>
          {/* Green is the app's direction-of-travel hue and the figure is a
              measured rise, so it carries it — the same green the account card's
              delta uses. With nothing above zero the tile goes back to Ink
              Secondary; a permanently coloured tile is one nobody reads. */}
          <CardTitle
            className={`text-2xl font-semibold tabular-nums ${fastest ? 'text-green-400' : ''}`}
          >
            {fastest === null ? '—' : formatPercent(fastest.percent)}
          </CardTitle>
          {fastest === null
            ? (
              <p className="text-[11px] text-zinc-400">
                Nothing grew over the last {SPIKE_WINDOW_DAYS} days
              </p>
            )
            : <AccountLine account={fastest.account} suffix={`· ${SPIKE_WINDOW_DAYS}d`} />}
        </CardHeader>
      </Card>
    </div>
  );
});

/**
 * The identity line under a named tile: the platform mark, the account's own
 * picture and its handle, at the Meta step.
 *
 * The same three marks in the same order as the account card and the signal
 * card, so the account the tile names is recognisable as the one in the grid
 * below without reading the handle. It truncates rather than wraps — a tile that
 * grew a line taller than its three neighbours because one handle is long would
 * break the row.
 */
function AccountLine({ account, suffix }: { account: GrowthAccount; suffix?: string }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
      <PlatformIcon platform={account.platform} className="size-3" />
      <AccountAvatar account={account} className="size-4" />
      <span className="truncate">{account.handle}</span>
      {suffix && <span className="shrink-0 tabular-nums">{suffix}</span>}
    </p>
  );
}
