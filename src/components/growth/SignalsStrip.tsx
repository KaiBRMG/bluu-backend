'use client';

import { memo, useId, useMemo } from 'react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { AccountAvatar, CategoryDot, PlatformIcon } from './growthUi';
import {
  SPIKE_THRESHOLD_MAX,
  SPIKE_THRESHOLD_MIN,
  SPIKE_THRESHOLD_STEP,
  SPIKE_WINDOW_DAYS,
  type GrowthSignal,
} from '@/lib/growth/signals';
import { formatCompact, formatPercent } from '@/lib/growth/metrics';
import type { GrowthAccount } from '@/types/firestore';

/**
 * Signals — the accounts growing fast enough right now to be worth interrupting
 * someone about.
 *
 * ── Why it is quiet ─────────────────────────────────────────────────────────
 * The design this page was rebuilt from gave this band a gradient wash and a
 * pulsing dot. Both are out: the Semantic-Only Rule forbids a gradient carrying
 * no state, and "nothing that bounces, slides far, or asks to be watched" rules
 * out an animation looping forever on a surface people sit in front of for eight
 * hours. What survives is the *structure* — a full-width band above the roster,
 * a row of cards you can scroll — and its urgency is carried the way this system
 * carries urgency everywhere else: a tint, a hairline, and the app's
 * attention-needed hue. It is loud relative to the greyscale grid below it,
 * which is all it needs to be.
 *
 * ── Why the threshold is on the band and not in a settings menu ─────────────
 * The band only exists while something clears the bar, so the bar is the single
 * thing that decides whether the reader sees this at all. Putting it here means
 * an empty band and an over-full one are both fixed in the same glance, without
 * hunting; it is view state, so there is nothing to save and nothing to undo.
 * The count is stated beside it because moving a slider that silently changes
 * how many cards exist is otherwise guesswork.
 */
export const SignalsStrip = memo(function SignalsStrip({
  signals,
  accountsById,
  threshold,
  onThresholdChange,
  onOpen,
}: {
  signals: GrowthSignal[];
  accountsById: Map<string, GrowthAccount>;
  threshold: number;
  onThresholdChange: (next: number) => void;
  onOpen: (account: GrowthAccount) => void;
}) {
  const sliderId = useId();

  const hasSignals = signals.length > 0;

  const cards = useMemo(
    () => signals
      .map((signal) => ({ signal, account: accountsById.get(signal.accountId) }))
      .filter((c): c is { signal: GrowthSignal; account: GrowthAccount } => c.account !== undefined),
    [signals, accountsById],
  );

  return (
    <section
      aria-labelledby={`${sliderId}-heading`}
      // The tint is the signal. With nothing above the bar the band drops to the
      // ordinary overlay recipe: an orange box that is orange every day of the
      // year is a box people stop reading, and the Semantic-Only Rule means the
      // hue has to be *encoding* something to be there at all. The band itself
      // stays — a control whose surface vanishes as you drag it reads as broken.
      className={cn(
        'rounded-xl border p-4 transition-colors duration-[120ms] ease-out',
        hasSignals
          ? 'border-orange-500/20 bg-orange-500/[0.06]'
          : 'border-white/[0.07] bg-white/[0.025]',
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          {/* Static. A dot that pulses forever trains people to stop seeing it. */}
          <span
            aria-hidden
            className={cn('size-2 shrink-0 rounded-full', hasSignals ? 'bg-orange-400' : 'bg-zinc-500')}
          />
          <h2 id={`${sliderId}-heading`} className="text-sm font-semibold">
            Signals
          </h2>
          <p className="text-xs text-zinc-400">
            {cards.length === 0
              ? `Nothing is growing faster than ${threshold}% a week`
              : `${cards.length} ${cards.length === 1 ? 'account is' : 'accounts are'} growing fast right now`}
          </p>
        </div>

        <div className="flex min-w-[220px] flex-1 items-center gap-3 sm:max-w-xs">
          {/* Not a <label>: the focusable element is Radix's thumb, not the
              root the id would land on, so `htmlFor` would point at nothing
              focusable. The slider's own `aria-label`/`aria-valuetext` carry the
              accessible name and value; this pair is the visible echo. */}
          <span aria-hidden className="shrink-0 text-xs text-zinc-400">Above</span>
          <Slider
            value={[threshold]}
            // Committed on every step, not on release: the band's own count and
            // tint must track the thumb, or a slider that silently changes how
            // many cards exist is guesswork. The roster below is what gets held
            // back — see `useDeferredValue` in the page.
            onValueChange={([next]) => onThresholdChange(next)}
            min={SPIKE_THRESHOLD_MIN}
            max={SPIKE_THRESHOLD_MAX}
            step={SPIKE_THRESHOLD_STEP}
            aria-label={`Signal threshold — percent growth over ${SPIKE_WINDOW_DAYS} days`}
            aria-valuetext={`${threshold} percent over ${SPIKE_WINDOW_DAYS} days`}
            className="flex-1"
          />
          <span aria-hidden className="w-[4.5rem] shrink-0 text-right text-xs text-zinc-400 tabular-nums">
            {threshold}% / {SPIKE_WINDOW_DAYS}d
          </span>
        </div>
      </div>

      {cards.length === 0 ? (
        // A band that vanished at zero would make the slider feel broken at the
        // exact moment it is being dragged past the top of the roster.
        <p className="text-sm text-zinc-400">
          Lower the threshold to see the roster’s strongest movers this week.
        </p>
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {cards.map(({ signal, account }) => (
            <button
              key={signal.accountId}
              type="button"
              onClick={() => onOpen(account)}
              className="flex w-[190px] shrink-0 flex-col rounded-lg border border-white/[0.07] bg-white/[0.04] p-3 text-left
                transition-colors duration-[120ms] ease-out
                hover:border-white/[0.12] hover:bg-white/[0.08]
                focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] focus-visible:outline-none"
            >
              <div className="mb-2 flex items-center gap-2">
                <AccountAvatar account={account} className="size-6" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <PlatformIcon platform={account.platform} className="size-3" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {account.handle}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-lg font-semibold tabular-nums">
                {account.latest ? formatCompact(account.latest.followers) : '—'}
              </span>
              <span className="text-xs font-medium text-orange-400 tabular-nums">
                {formatPercent(signal.percent)} this week
              </span>
              <CategoryDot category={account.category} className="mt-1.5" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
});
