'use client';

import Image from 'next/image';
import { ArrowUpRightIcon, CircleAlertIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import { PLATFORM_LABEL, type GrowthPlatform } from '@/lib/growth/platform';
import {
  CATEGORIES_BY_PLATFORM, CATEGORY_TONE, type GrowthCategory,
} from '@/lib/growth/category';
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
 * The fallback is seeded from `handle`, which is the ONLY name this subsystem
 * has — there is no separate display name. DESIGN.md's Avatar Seed Rule names
 * `displayName` because that is the field on a `users` doc; what the rule is
 * actually protecting is that one account hashes to one colour everywhere, and
 * the handle is the stable identity here (the document id is built from it).
 * Seed from anything else and the same account renders differently per screen.
 */
export function AccountAvatar({
  account,
  className,
}: {
  account: Pick<GrowthAccount, 'handle' | 'profilePictureUrl'>;
  className?: string;
}) {
  const seed = account.handle || 'Account';
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
  iconClassName,
}: {
  account: Pick<GrowthAccount, 'platform' | 'handle' | 'profilePictureUrl'>;
  avatarClassName?: string;
  iconClassName?: string;
}) {
  return (
    <>
      <PlatformIcon platform={account.platform} className={iconClassName} />
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
 * The account's category, as a chip it carries.
 *
 * Coloured, where the platform chip beside it is not, and the difference is the
 * rule rather than a preference: a category is a **closed vocabulary with a
 * meaning per value**, which is the one thing DESIGN.md says earns a hue — the
 * platform is already carried by its own mark, so colouring that too would be
 * decoration. The triad lives in `category.ts`; never re-map it inline.
 *
 * Built on the shadcn `Badge` — the house primitive for exactly this mark
 * (CLAUDE.md rule 13). `variant="outline"` is the closest base to the tinted
 * triad: a transparent fill and a real border, both of which `CATEGORY_TONE`
 * then overrides through `cn`'s tailwind-merge.
 *
 * Three overrides on top of it, each load-bearing rather than taste:
 *  - `rounded-md` — Badge is a pill by default, and square-ish is what keeps
 *    this from being read as a status pill (every attribute chip in the app is
 *    square; every status is round).
 *  - `text-[11px]` — the Meta step, so the chip fits a dense table row.
 *  - `px-1.5` — Badge's `px-2` is sized for its larger text.
 */
export function CategoryChip({
  category,
  className,
}: {
  category: GrowthCategory;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('rounded-md px-1.5 py-0.5 text-[11px]', CATEGORY_TONE[category].chip, className)}
    >
      {category}
    </Badge>
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
        {/* The reason is the whole actionable content, and `title` alone never
            reaches a keyboard or a screen reader. The tooltip stays for the
            mouse; this is what everyone else gets. */}
        {account.lastScrapeError && <span className="sr-only">: {account.lastScrapeError}</span>}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-zinc-400 tabular-nums">
      {new Date(account.lastScrapeAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
    </span>
  );
}

/**
 * A filter chip carrying its own count. Shared by the overview and the
 * tracked-posts view so
 * the two filter rows are the same control, not two that merely resemble it.
 *
 * Selected is the filled Action Blue Deep (`#2563eb`), never `#3b82f6` — white
 * on the lighter blue measures 3.68:1 and fails AA at this size (DESIGN.md §2).
 */
export function FilterChip({
  active, onClick, count, category, children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  /**
   * When this chip filters by category, the category it filters by — the chip
   * then wears that category's hue in both states rather than the page's Action
   * Blue. That is the only way the colour coding survives the filter row: a
   * category chip that turned blue when picked would teach the hue and then take
   * it away at the exact moment it is being used.
   */
  category?: GrowthCategory;
  children: React.ReactNode;
}) {
  const tone = category ? CATEGORY_TONE[category] : null;
  return (
    // The chip's *appearance* is the house `Badge`; its *semantics* are a
    // button, because this one is pressed. `asChild` is the sanctioned way to
    // keep both — hand-rolling the chip to get a button back would be the rule 13
    // violation, and rendering a <span> to get the Badge would lose the control.
    <Badge
      asChild
      variant="outline"
      className={cn(
        'gap-1.5 px-2.5 py-1 transition-colors',
        // Badge's own focus ring is `--ring` zinc at 3px and it recolours the
        // border with it. Keyboard focus is current selection, so it takes the
        // one Action Blue voice at the house width (DESIGN.md §5).
        'focus-visible:border-transparent focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6]',
        tone
          ? active
            ? tone.active
            : `${tone.chip} hover:brightness-110`
          : active
            ? 'border-[#2563eb] bg-[#2563eb] text-white'
            : 'border-transparent text-zinc-400 hover:bg-white/[0.055] hover:text-zinc-300 active:bg-white/[0.08]',
      )}
    >
      <button type="button" onClick={onClick} aria-pressed={active}>
        {children}
        {/* No `opacity` on the count. Stacked on Ink Secondary it is double
          de-emphasis, and on the filled chip it drops white-on-#2563eb from
          5.17:1 to ~3.7:1 at 12px — under AA (DESIGN.md, The One De-emphasis
          Rule). The chip's own colour already separates it from the label. */}
        <span className="tabular-nums">{count}</span>
      </button>
    </Badge>
  );
}

/**
 * The category as a bare dot plus its label — the compact form, for the account
 * card and the signal card where a bordered chip would be the loudest thing in
 * a 250px box.
 *
 * An account with no category still renders a line, in the neutral step: an
 * unfiled account is a real state the manage tab can fix, and a card that simply
 * omitted the row would jump a few pixels shorter than its neighbours for a
 * reason the reader cannot see.
 */
export function CategoryDot({
  category,
  className,
}: {
  category: GrowthCategory | null;
  className?: string;
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          category ? CATEGORY_TONE[category].dot : 'bg-zinc-500',
        )}
      />
      <span className="truncate text-[11px] text-zinc-400">{category ?? 'Unfiled'}</span>
    </span>
  );
}

/**
 * "The last scheduled read of this account failed" — the roster card's copy of
 * what `ScrapeStatus` says in the manage table.
 *
 * **Red, where the card's other warning mark is orange.** A spike is *attention
 * needed*; a failed read is an error, and the two are different alarms. They can
 * both be true at once (the spike is computed from history, the failure happened
 * last night), which is also why this does not reuse the manage table's
 * `TriangleAlertIcon` — that glyph already means "posts faster than one nightly
 * read can see" in this subsystem, and separating two warnings by hue alone is
 * exactly the failure the colour rules exist to prevent. Different alarm,
 * different shape.
 *
 * **It says "Read failed", not "Failed".** In the manage table the column header
 * supplies the subject; on a card there is no header, and a bare "Failed" beside
 * a follower count reads as a verdict on the account rather than on the scrape.
 *
 * The reason is `sr-only` as well as in `title`: a tooltip on a non-interactive
 * mark never reaches a keyboard or a screen reader, and this card is a button —
 * nothing inside it may become a second focus stop to carry the message.
 */
export function ScrapeFailedBadge({
  error,
  className,
}: {
  error: string | null;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-0.5 rounded-md border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-400',
        className,
      )}
      title={error ?? undefined}
    >
      <CircleAlertIcon aria-hidden />
      Read failed
      {error && <span className="sr-only">: {error}</span>}
    </Badge>
  );
}

/**
 * "This account grew unusually fast this week."
 *
 * Orange because that is the app's *attention needed* hue (DESIGN.md §2) and a
 * signal is exactly that — something to go and look at — not a success ("green")
 * and not a failure. It is a derived state, never a stored field; see
 * `src/lib/growth/signals.ts` for why the window is fixed at seven days while
 * everything around it follows the range control.
 */
export function SpikeBadge({ percent, className }: { percent: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-md bg-orange-500/10 px-1.5 py-0.5',
        'text-[11px] font-medium text-orange-400 tabular-nums',
        className,
      )}
      title={`Followers up ${formatPercent(percent)} over the last 7 days`}
    >
      <ArrowUpRightIcon className="size-3" aria-hidden />
      {formatPercent(percent)}
      <span className="sr-only"> over 7 days</span>
    </span>
  );
}

/**
 * The account's category, editable in place — shared by the manage table and the
 * account panel, so the two cannot drift into offering different vocabularies.
 *
 * **The options are the account's own platform's**, not the whole vocabulary:
 * TWXNK / BONUS / SFW REPOST describe how the X roster is run and mean nothing
 * on a Facebook page, which is GENERAL or CREATOR. The server checks the same
 * thing against the stored platform — this list is the affordance, not the
 * validation.
 *
 * Radix reserves the empty string as "no value", so "no category" travels as a
 * sentinel and is mapped back to `null` — the same trick the add dialog uses.
 *
 * `dot` is the one thing the two call sites disagree about, and the reason is
 * worth stating. In the manage table the trigger stays greyscale: a coloured
 * `Select` in a column of controls reads as a status control rather than a
 * picker, and that table shows the hue elsewhere. On the account panel this
 * control *replaces* `CategoryDot` — the only place that account's category
 * colour appeared — so the mark moves inside the trigger rather than being lost.
 */
const NO_CATEGORY = 'none';

export function CategorySelect({
  account,
  busy,
  onChange,
  dot = false,
  className,
}: {
  account: GrowthAccount;
  busy: boolean;
  onChange: (next: GrowthCategory | null) => void;
  /** Show the category's colour inside the trigger. See above. */
  dot?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={account.category ?? NO_CATEGORY}
      disabled={busy}
      onValueChange={(v) => onChange(v === NO_CATEGORY ? null : (v as GrowthCategory))}
    >
      <SelectTrigger
        size="sm"
        className={cn('text-xs', className)}
        aria-label={`Category for @${account.handle}`}
      >
        {dot && (
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              account.category ? CATEGORY_TONE[account.category].dot : 'bg-zinc-500',
            )}
          />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CATEGORY}>Unfiled</SelectItem>
        {CATEGORIES_BY_PLATFORM[account.platform].map((c) => (
          <SelectItem key={c} value={c}>{c}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
