'use client';

import { memo } from 'react';
import { StarIcon } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { Button } from '@/components/ui/button';
import {
  AccountAvatar, CategoryDot, DeltaValue, PlatformIcon, ReadProblemBadge, SpikeBadge,
} from './growthUi';
import {
  formatCompact,
  formatCount,
  readProblemOf,
  sparklineFor,
  type DayMap,
  type GrowthDelta,
} from '@/lib/growth/metrics';
import { STATUS_HEX } from '@/lib/campaignTracking';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import type { GrowthAccount } from '@/types/firestore';

/**
 * One tracked account, as a card in the overview grid.
 *
 * ── Why a grid of cards replaced a shared-axis chart ────────────────────────
 * The old overview drew every account as a line on one pair of axes, which meant
 * inventing a mode (indexed / net / absolute) to stop a 684k page flattening a
 * 13k one into the baseline. A card carries **its own** sparkline on **its own**
 * scale, so the scale problem stops existing rather than being worked around:
 * each account's shape is legible at its own magnitude, and the follower count
 * beside it is the thing that states the magnitude. What is lost is direct
 * cross-account comparison of shape — which the ranked figures and the Signals
 * strip above cover better than twelve overlapping traces did.
 *
 * ── The card opens; the star pins ───────────────────────────────────────────
 * The whole card used to be one `<button>`, which was honest while it had
 * nothing else inside it. The pin star is a second control, and a button cannot
 * contain another — so the card is now a plain surface with an **`inset-0`
 * overlay button** that opens the account, and the star sits `relative` above
 * it. The same construction as `SaleDisputesPanel`'s compact rows: the whole
 * card is still the open target, with no dead strip around the star. The
 * content between them is `pointer-events-none`, so a click anywhere but the
 * star falls through to the overlay.
 *
 * The star is revealed on hover **and** `:focus-within` (the keyboard path —
 * DESIGN.md § Interaction), and stays visible whenever the account is pinned,
 * because then it is a state rather than an action. Pinned is the Action Blue
 * fill, the same mark the Resources page uses for a pin: a pin is the user's
 * own selection, which is the one job that hue has.
 *
 * Colour on this surface is rationed to five jobs, each of them a state: the
 * delta's direction (green / red), a spike (orange, *attention needed*), a
 * failed or Stopped read (red, an error), the category dot (a vocabulary with a
 * chosen colour per value), and the pinned star (Action Blue, selection). The
 * platform mark stays greyscale; brand colour would be decoration.
 *
 * ── The failed-read and Stopped marks ───────────────────────────────────────
 * Without them the card's failure state is *invisible in exactly the way that
 * matters*: a scrape that failed leaves the last good reading in place, so the
 * figure and the sparkline still look like current data. **Stopped** replaces
 * "Read failed" once the streak reaches the limit — it is the stronger claim
 * about the same failure, and it is the one that needs a person to act.
 *
 * Both are gated on `isActive`. A stopped-tracking account is not scraped at
 * all, so its `lastScrapeStatus` is frozen at whatever it was the night tracking
 * was turned off — rendering that as a live failure would report a job that is
 * not running and cannot fail.
 *
 * A failed read and a spike can both be true (the spike is computed from
 * history), so the marks stack rather than competing for one slot, error first.
 */
export const AccountCard = memo(function AccountCard({
  account,
  days,
  from,
  delta,
  spikePercent,
  pinned,
  onOpen,
  onTogglePin,
}: {
  account: GrowthAccount;
  days: DayMap;
  from: string | null;
  delta: GrowthDelta;
  /** Seven-day growth when it is above the active threshold, else `null`. */
  spikePercent: number | null;
  /** Whether this account is on the viewer's home widget. */
  pinned: boolean;
  onOpen: (account: GrowthAccount) => void;
  onTogglePin: (account: GrowthAccount) => void;
}) {
  const points = sparklineFor(days, from);
  const rising = delta.change !== null && delta.change > 0;
  const falling = delta.change !== null && delta.change < 0;
  const readProblem = readProblemOf(account);

  return (
    <div
      // Overlay recipe, so it takes the overlay hover steps rather than a
      // brightness nudge (DESIGN.md § Interaction). Hover and press are read
      // off the whole card, so they fire wherever the pointer is on it.
      className={cn(
        'group relative flex w-full flex-col rounded-xl p-4 text-left',
        SURFACE,
        'transition-colors duration-[120ms] ease-out',
        'hover:border-white/[0.12] hover:bg-white/[0.055] has-[>button:active]:bg-white/[0.08]',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(account)}
        aria-label={`Open @${account.handle}`}
        // The content above is `pointer-events-none`, so the exact figure's
        // tooltip lives on the element the pointer actually rests on.
        title={delta.last === null ? undefined : `@${account.handle} · ${formatCount(delta.last)} followers`}
        className="absolute inset-0 rounded-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] focus-visible:outline-none"
      />

      <div className="pointer-events-none mb-3 flex items-start gap-2.5">
        <AccountAvatar account={account} className="size-9 rounded-[9px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <PlatformIcon platform={account.platform} className="size-3" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{account.handle}</span>
          </div>
          <CategoryDot category={account.category} className="mt-0.5" />
        </div>
        {(readProblem || spikePercent !== null) && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <ReadProblemBadge item={account} subject="account" />
            {spikePercent !== null && <SpikeBadge percent={spikePercent} />}
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onTogglePin(account)}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin @${account.handle} from your home page` : `Pin @${account.handle} to your home page`}
          title={pinned ? 'Unpin from home' : 'Pin to home'}
          className={cn(
            // Above the overlay, and the one thing in this row that takes the
            // pointer. `-m-1` keeps a 28px hit area without pushing the badges.
            'pointer-events-auto relative -m-1 size-7 shrink-0 text-zinc-400 hover:text-white',
            pinned
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          )}
        >
          <StarIcon
            className={cn('size-3.5', pinned && 'fill-action-blue text-action-blue')}
            aria-hidden
          />
        </Button>
      </div>

      <div className="pointer-events-none mb-2 flex items-baseline justify-between gap-2">
        <span
          className="text-2xl font-semibold tabular-nums"
          // The compact form is what fits a 250px card; the exact figure is one
          // hover away (on the overlay) and is the headline of the detail view.
        >
          {delta.last === null ? '—' : formatCompact(delta.last)}
        </span>
        <DeltaValue delta={delta} showPercent={false} className="text-xs font-medium" />
      </div>

      {/*
        The trend takes the delta's own colour here, where the leaderboard drew
        it greyscale. On a card there is no shared axis and no highlighted trace
        to reserve hue for, and the line and the figure beside it are stating one
        fact — so tinting both is reinforcement, not a second signal. It stays
        `aria-hidden`: the delta says the same thing in words.
      */}
      <Sparkline
        points={points}
        // Above the widest card the grid produces, so the viewBox is compressed
        // rather than stretched — see `Sparkline`'s `width` note.
        width={480}
        height={36}
        stroke={rising ? STATUS_HEX.green : falling ? STATUS_HEX.red : undefined}
        className="pointer-events-none w-full"
      />
    </div>
  );
});
