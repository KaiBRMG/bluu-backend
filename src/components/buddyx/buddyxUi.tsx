'use client';

/**
 * Small atoms shared by every BuddyX-backed surface.
 *
 * The two attribution sentences are **copy of record** — the plan fixes their
 * wording, and they appear on the Sales Report, the dispute dialog, Chatter
 * Analytics and CA Admin → Sales. One constant each, so the sentence an agent
 * reads beside a tile is the sentence the server returns when it refuses a PPV.
 */
import { Info, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CLAIM_REFUSAL_LABEL } from '@/lib/disputes/disputeRules';

export const TIPS_ATTRIBUTION = 'Tips are assigned to the chat agent on shift at the time of sale';
export const PPV_ATTRIBUTION = CLAIM_REFUSAL_LABEL.ppv;

/**
 * Gross vs net, said the same way everywhere. Every money figure on a BuddyX
 * surface is labelled one or the other; these are the sentences behind the
 * labels. BuddyX's own split is `net = gross × 0.8` (buddyxapi.yaml).
 */
export const GROSS_NOTE = 'Gross — what the fan paid. Net is 80% of gross; OnlyFans keeps 20%.';
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

/**
 * A fan: the name when we know it, otherwise the OnlyFans id in mono linked to
 * the profile. Never "Unknown" — an id is a fact, "Unknown" is a shrug.
 */
export function FanLabel({ name, fanId, className }: { name: string | null | undefined; fanId: string; className?: string }) {
  if (name) return <span className={cn('truncate', className)} title={fanId ? `Fan ${fanId}` : undefined}>{name}</span>;
  if (!fanId) return <span className={cn('text-zinc-400', className)}>—</span>;
  return (
    <a
      href={`https://onlyfans.com/u${encodeURIComponent(fanId)}`}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'rounded-sm font-mono text-xs text-zinc-300 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
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
  basis?: 'gross' | 'net';
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

/** "gross" / "net" beside a money label, with the split explained on hover. */
export function BasisTag({ basis }: { basis: 'gross' | 'net' }) {
  return (
    <span
      title={GROSS_NOTE}
      className="rounded-md bg-white/[0.08] px-1 py-px text-[10px] font-medium uppercase tracking-wide text-zinc-300"
    >
      {basis}
    </span>
  );
}

/** One fact in a definition list: label, figure, optional Meta line. */
export function Fact({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-400">{label}</dt>
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
