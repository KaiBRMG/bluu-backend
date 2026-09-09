'use client';

import { memo } from 'react';
import { Sparkline } from './Sparkline';
import { AccountAvatar, CategoryDot, DeltaValue, PlatformIcon, SpikeBadge } from './growthUi';
import {
  formatCompact,
  formatCount,
  sparklineFor,
  type DayMap,
  type GrowthDelta,
} from '@/lib/growth/metrics';
import { STATUS_HEX } from '@/lib/campaignTracking';
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
 * ── The whole card is the button ────────────────────────────────────────────
 * There is nothing else interactive inside it, so making the card itself the
 * control is the honest markup — unlike the tables elsewhere in this subsystem,
 * where `role="button"` on a `<tr>` would have orphaned the cells. The focus
 * ring is Action Blue, the one voice that means "act here".
 *
 * Colour on this surface is rationed to three jobs, each of them a state: the
 * delta's direction (green / red), a spike (orange, *attention needed*), and the
 * category dot (a closed vocabulary — the one label DESIGN.md lets carry a hue).
 * The platform mark stays greyscale; brand colour would be decoration.
 */
export const AccountCard = memo(function AccountCard({
  account,
  days,
  from,
  delta,
  spikePercent,
  onOpen,
}: {
  account: GrowthAccount;
  days: DayMap;
  from: string | null;
  delta: GrowthDelta;
  /** Seven-day growth when it is above the active threshold, else `null`. */
  spikePercent: number | null;
  onOpen: (account: GrowthAccount) => void;
}) {
  const points = sparklineFor(days, from);
  const rising = delta.change !== null && delta.change > 0;
  const falling = delta.change !== null && delta.change < 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(account)}
      // Overlay recipe, so it takes the overlay hover steps rather than a
      // brightness nudge (DESIGN.md § Interaction).
      className="flex w-full flex-col rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 text-left
        transition-colors duration-[120ms] ease-out
        hover:border-white/[0.12] hover:bg-white/[0.055] active:bg-white/[0.08]
        focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] focus-visible:outline-none"
    >
      <div className="mb-3 flex items-start gap-2.5">
        <AccountAvatar account={account} className="size-9 rounded-[9px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <PlatformIcon platform={account.platform} className="size-3" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{account.handle}</span>
          </div>
          <CategoryDot category={account.category} className="mt-0.5" />
        </div>
        {spikePercent !== null && <SpikeBadge percent={spikePercent} />}
      </div>

      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span
          className="text-2xl font-semibold tabular-nums"
          // The compact form is what fits a 250px card; the exact figure is one
          // hover away and is the headline of the detail view.
          title={delta.last === null ? undefined : `${formatCount(delta.last)} followers`}
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
        className="w-full"
      />
    </button>
  );
});
