'use client';

/**
 * Small atoms shared by every BuddyX-backed surface.
 *
 * The two attribution sentences are **copy of record** — the plan fixes their
 * wording, and they appear on the Sales Report, the dispute dialog, Chatter
 * Analytics and CA Admin → Sales. One constant each. They describe how BuddyX
 * attributes a sale; who Bluu Backend holds it on can differ after a dispute or
 * an admin reassignment, which every ledger row states (`SaleHolderNote`).
 */
import Link from 'next/link';
import { Info, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { profileLinkForKey } from '@/lib/fans/fanIdentity';

export const TIPS_ATTRIBUTION = 'Tips are assigned to the chat agent on shift at the time of sale';
export const PPV_ATTRIBUTION = 'PPV sales are assigned to the sender';

/**
 * How Bluu Backend's own ledger (`ca-sales` — pay, the Sales Report, CA Admin →
 * Sales, disputes) credits a sale. Not BuddyX's rule above: the sync credits
 * every sale, PPVs included, to the agent the shift schedule had on the
 * account (`scheduleHolder`), and falls back to BuddyX only without one.
 */
export const LEDGER_TIPS_ATTRIBUTION =
  'Tips are credited to the chat agent on shift on the account at the time of sale — BuddyX’s pick when nobody was scheduled';
export const LEDGER_PPV_ATTRIBUTION =
  'PPV sales are credited to the chat agent on shift on the account when the fan unlocks it, not the sender — the sender only when nobody was scheduled';

/**
 * Gross vs net, said the same way everywhere. Every money figure on a BuddyX
 * surface is labelled one or the other; these are the sentences behind the
 * labels. BuddyX's own split is `net = gross × 0.8` (buddyxapi.yaml).
 */
export const GROSS_NOTE = 'Gross — what the fan paid. Net is 80% of gross; OnlyFans keeps 20%.';
/** Net on Bluu's own ledger (pay, the Sales Report, CA Admin): the deduction is configurable, so no fixed 80%. */
export const LEDGER_NET_NOTE = 'Net — gross less the platform deduction (OnlyFans’ share; 20% unless CA Admin → Rates says otherwise). Pay is worked out on net.';
export const NET_NOTE = 'Net — what the creator receives: 80% of gross, after OnlyFans keeps 20%. Matches OnlyFans’ own earnings statement to within a few cents.';
/**
 * The few BuddyX money fields that are a bare number, not a {gross, net} pair:
 * link revenue and a link fan's total spent. The API does not say which they are.
 */
export const LINK_REVENUE_NOTE = 'As BuddyX reports it for the link — its API does not say whether this is gross or net.';

/**
 * An `Info` icon carrying a sentence. Keyboard-focusable, and never the only
 * carrier of meaning — the thing it sits beside must read on its own.
 */
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className={cn(
            'inline-flex shrink-0 rounded-sm text-zinc-400 transition-colors duration-[120ms] hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  );
}

/** The fan report for a fan id or registry key. */
export const fanReportHref = (fanKey: string) => `/ca-portal/fan-analytics/${encodeURIComponent(fanKey)}`;

const FAN_LINK =
  'rounded-sm underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * A fan: the name when we know it, otherwise the OnlyFans id in mono. Never
 * "Unknown" — an id is a fact, "Unknown" is a shrug.
 *
 * `linkToReport` (pass it only when the viewer has Fan Analytics) makes either
 * form open the fan's report; without it an unnamed fan links to their
 * OnlyFans profile instead.
 */
export function FanLabel({
  name,
  fanId,
  className,
  linkToReport = false,
}: {
  name: string | null | undefined;
  fanId: string;
  className?: string;
  linkToReport?: boolean;
}) {
  if (!fanId) return <span className={cn(name ? 'truncate' : 'text-zinc-400', className)}>{name || '—'}</span>;
  if (linkToReport) {
    return (
      <Link
        href={fanReportHref(fanId)}
        prefetch={false}
        title={`Fan ${fanId}`}
        className={cn(FAN_LINK, name ? 'truncate' : 'font-mono text-xs text-zinc-300', className)}
      >
        {name || fanId}
      </Link>
    );
  }
  if (name) return <span className={cn('truncate', className)} title={`Fan ${fanId}`}>{name}</span>;
  return (
    <a
      href={profileLinkForKey(fanId)}
      target="_blank"
      rel="noreferrer"
      className={cn(FAN_LINK, 'font-mono text-xs text-zinc-300', className)}
    >
      {fanId}
    </a>
  );
}

/** The greyscale attribute chip (DESIGN.md §5). */
export function AttrChip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300', className)}>
      {children}
    </span>
  );
}

/** A colour key square for a chart legend. Identity is never the square alone. */
export function LegendSwatch({ color }: { color: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden />;
}

/**
 * The segmented-control item class — re-exported from Growth Tracking, which
 * owns the measured on-state (DESIGN.md §5, ToggleGroup). One definition.
 */
export { SEGMENT_ITEM_CLASS as SEGMENT } from '@/components/growth/growthUi';

/** The house summary tile: label (+ optional InfoTip), Display-step figure, Meta line. */
export function KpiTile({
  label,
  value,
  meta,
  tip,
  href,
  basis,
}: {
  label: string;
  value: string;
  meta?: React.ReactNode;
  tip?: string;
  href?: string;
  /** Money tiles say which figure they are — never leave gross vs net to a guess. */
  basis?: MoneyTag;
}) {
  return (
    <Card className="gap-1.5 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-1.5">
          {label}
          {basis && <BasisTag basis={basis} />}
          {tip && <InfoTip text={tip} />}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
        {meta &&
          (href ? (
            <a href={href} className="text-[11px] text-zinc-400 underline-offset-2 hover:text-white hover:underline">
              {meta}
            </a>
          ) : (
            <div className="text-[11px] text-zinc-400">{meta}</div>
          ))}
      </CardHeader>
    </Card>
  );
}

/** Which money figure a label is: either half of BuddyX's pair, or a bare number it never qualified. */
export type MoneyTag = 'gross' | 'net' | 'reported';

const BASIS_TAG: Record<MoneyTag, { text: string; note: string; className: string }> = {
  gross: { text: 'Gross', note: GROSS_NOTE, className: 'border-transparent bg-white/[0.12] text-zinc-200' },
  net: { text: 'Net', note: NET_NOTE, className: 'border-zinc-400/60 text-zinc-200' },
  reported: { text: 'As reported', note: LINK_REVENUE_NOTE, className: 'border-dashed border-zinc-500 text-zinc-300' },
};

/**
 * The basis label on a money figure — `GROSS`, `NET` or `AS REPORTED`. **The
 * tag is the label**: it sits beside the figure's name and the word is never
 * repeated in that name ("Earnings GROSS", not "Gross earnings GROSS").
 * Greyscale (an attribute, not a state), and never the word alone: gross is a
 * filled chip, net an outlined one, as-reported a dashed one, so two figures
 * read as different before either tag is read. The split is on hover.
 */
export function BasisTag({ basis, note }: { basis: MoneyTag; /** Overrides the hover sentence — `LEDGER_NET_NOTE` on ledger surfaces. */ note?: string }) {
  const tag = BASIS_TAG[basis];
  return (
    <span
      title={note ?? tag.note}
      className={cn('shrink-0 whitespace-nowrap rounded-md border px-1 py-px text-[10px] font-semibold uppercase leading-[14px] tracking-wide', tag.className)}
    >
      {tag.text}
    </span>
  );
}

/** One fact in a definition list: label (+ basis tag on money), figure, optional Meta line. */
export function Fact({ label, value, meta, basis }: { label: string; value: string; meta?: string; basis?: MoneyTag }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-zinc-400">
        {label}
        {basis && <BasisTag basis={basis} />}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      {meta && <dd className="text-[11px] text-zinc-400">{meta}</dd>}
    </div>
  );
}

/** A failed read is a state, never an empty page: the error and a way to retry. */
export function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <p className="text-sm text-red-400">{error}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RotateCcw className="size-3.5" aria-hidden /> Try again
      </Button>
    </div>
  );
}
