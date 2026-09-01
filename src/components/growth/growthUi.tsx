'use client';

import { IconBrandFacebookFilled, IconBrandXFilled } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { PLATFORM_LABEL, type GrowthPlatform } from '@/lib/growth/platform';
import { formatDelta, formatPercent, type GrowthDelta } from '@/lib/growth/metrics';
import type { GrowthAccount } from '@/types/firestore';

/**
 * Shared marks for the Growth Tracking surfaces.
 *
 * The one colour decision worth stating: the **platform** is greyscale.
 * Facebook-blue and X-black would be brand decoration, not state — and the
 * Semantic-Only Rule bans exactly that. The glyph carries the platform; hue is
 * reserved for direction of travel (up / down) and for the one Action Blue
 * voice, which here marks the highlighted account.
 *
 * The `Filled` Tabler variants, not the outline ones: both platforms' real marks
 * are solid glyphs, and the stroked versions read as a generic "f" in a box
 * rather than as Facebook. These are still Tabler's interpretations, not the
 * official brand assets — see DESIGN.md § Navigation for the `SVG_ICONS`
 * escape hatch if a true brand mark is ever wanted here.
 */

/**
 * Segmented-control item styling, shared by the chart-mode and date-range groups.
 *
 * shadcn's `outline` toggle variant paints **both** hover and the on-state with
 * `bg-accent`, so the selected option is indistinguishable from the hovered one
 * and measures ~1.5:1 against the card — under the 3:1 floor WCAG 1.4.11 sets for
 * a state indicator. Selection is therefore the filled Action Blue Deep the
 * page's own filter chips already use: `#2563eb`, never `#3b82f6` (white on the
 * lighter blue is 3.68:1 and fails AA at this size — DESIGN.md §2).
 *
 * The trailing `!` is deliberate. It beats the primitive's own `data-[state=on]`
 * rule regardless of stylesheet order, which two same-specificity selectors
 * otherwise decide by chance.
 */
export const SEGMENT_ITEM_CLASS =
  'text-xs data-[state=on]:bg-[#2563eb]! data-[state=on]:font-medium data-[state=on]:text-white!';

export function PlatformIcon({ platform, className }: { platform: GrowthPlatform; className?: string }) {
  const Icon = platform === 'facebook' ? IconBrandFacebookFilled : IconBrandXFilled;
  return <Icon className={cn('size-3.5 shrink-0 text-zinc-400', className)} aria-hidden />;
}

/** Platform as a greyscale attribute chip — a label the account carries, not a state. */
export function PlatformChip({ platform }: { platform: GrowthPlatform }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
      <PlatformIcon platform={platform} className="size-3" />
      {PLATFORM_LABEL[platform]}
    </span>
  );
}

/**
 * A change, rendered with the sign doing the work.
 *
 * Green up / red down is a genuine closed vocabulary (the `-400` semantic steps),
 * and `null` — fewer than two readings — renders as an em dash rather than a
 * zero. "We have not measured this yet" and "this did not change" are different
 * facts, and a 0 that means the first is a lie the reader cannot detect.
 */
export function DeltaValue({
  delta,
  showPercent = true,
  className,
}: {
  delta: GrowthDelta;
  showPercent?: boolean;
  className?: string;
}) {
  if (delta.change === null) {
    return (
      <span className={cn('text-zinc-400 tabular-nums', className)} title={
        delta.points === 0 ? 'No readings in this range' : 'Only one reading so far — a change needs two'
      }>
        —
      </span>
    );
  }

  const tone = delta.change > 0 ? 'text-green-400' : delta.change < 0 ? 'text-red-400' : 'text-zinc-400';
  return (
    <span className={cn('tabular-nums', tone, className)}>
      {formatDelta(delta.change)}
      {showPercent && delta.percent !== null && (
        <span className="ml-1.5 text-[11px] text-zinc-400">{formatPercent(delta.percent)}</span>
      )}
    </span>
  );
}

/**
 * Scrape health for one account. Deliberately quiet when everything is fine —
 * a green "OK" pill on every row is noise that trains people to stop reading the
 * column, which is the column's only job.
 */
export function ScrapeStatus({ account }: { account: GrowthAccount }) {
  if (!account.lastScrapeAt) {
    return <span className="text-[11px] text-zinc-400">First reading tonight</span>;
  }
  if (account.lastScrapeStatus === 'failed') {
    return (
      <span
        className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400"
        title={account.lastScrapeError ?? undefined}
      >
        Failed
      </span>
    );
  }
  return (
    <span className="text-[11px] text-zinc-400 tabular-nums">
      {new Date(account.lastScrapeAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
    </span>
  );
}
