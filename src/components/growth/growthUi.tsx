'use client';

import Image from 'next/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
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
 * The marks themselves are image assets, not Tabler glyphs — the `SVG_ICONS`
 * escape hatch in DESIGN.md § Navigation, taken for the same reason OF Manager
 * takes it: these are real third-party brand marks with no lucide equivalent,
 * and Tabler's interpretations read as a generic "f" in a box rather than as
 * Facebook. They render through `next/image` exactly as `PageIcon` does.
 *
 * **The ink is baked into the file at zinc-400.** A raster cannot inherit
 * `currentColor`, so a `text-*` class on this component does nothing — sizing is
 * all `className` can still do. That is fine today (the mark is greyscale on
 * every surface it appears on), but a future hover- or selection-tint cannot be
 * a colour class: it needs a second asset, or the marks go back to inline SVG.
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

const PLATFORM_MARK: Record<GrowthPlatform, string> = {
  facebook: '/Icons/icons8-facebook.webp',
  twitter: '/Icons/icons8-x.webp',
};

export function PlatformIcon({ platform, className }: { platform: GrowthPlatform; className?: string }) {
  return (
    <Image
      src={PLATFORM_MARK[platform]}
      alt=""
      aria-hidden
      // The source is 128px square so the mark stays crisp at 3x DPI; the
      // rendered size is the `size-*` class, as it was with the glyphs.
      width={128}
      height={128}
      className={cn('size-3.5 shrink-0', className)}
    />
  );
}

/**
 * The account's own profile picture, scraped alongside the follower count.
 *
 * Both actors return one inside the already-billed result (Facebook
 * `profilePictureUrl`, X `profilePicture`), and it is re-read on every
 * successful nightly scrape — which is what makes it usable at all, because
 * **Facebook's `fbcdn.net` URLs are signed and expire**, typically within days.
 * A stored URL is therefore at most a night old; one belonging to an account
 * whose scrape has been failing will eventually rot, and the fallback is what
 * the reader sees then. It is a real state, not decoration:
 *
 *  - the twelve seeded accounts have `null` until their first successful scrape
 *    (the spreadsheets had no images), and
 *  - an expired or 404ing URL falls through to the same place.
 *
 * So the fallback is seeded from `displayName` per DESIGN.md's Avatar Seed Rule
 * — `getAvatarColor` hashes the string it is given, so seeding from the handle
 * or the id instead would render the same account differently across screens.
 */
export function AccountAvatar({
  account,
  className,
}: {
  account: Pick<GrowthAccount, 'displayName' | 'handle' | 'profilePictureUrl'>;
  className?: string;
}) {
  const seed = account.displayName || account.handle || 'Account';
  return (
    <Avatar className={cn('size-6 shrink-0', className)}>
      {account.profilePictureUrl && (
        // Decorative: the account name sits directly beside it in every use.
        <AvatarImage src={account.profilePictureUrl} alt="" />
      )}
      <AvatarFallback
        className="text-[10px] font-medium"
        style={{ background: getAvatarColor(seed), color: '#fff' }}
      >
        {getInitials(seed)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Platform mark + profile picture, the pair that identifies an account at a
 * glance. The platform leads because it is the fact that never fails to load —
 * the picture beside it may be absent, and a row that opened with a hole would
 * read as broken rather than as pending.
 */
export function AccountIdentity({
  account,
  avatarClassName,
}: {
  account: Pick<GrowthAccount, 'platform' | 'displayName' | 'handle' | 'profilePictureUrl'>;
  avatarClassName?: string;
}) {
  return (
    <>
      <PlatformIcon platform={account.platform} />
      <AccountAvatar account={account} className={avatarClassName} />
    </>
  );
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
