'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatDuration, formatShare } from '@/lib/buddyx/analyticsFormat';
import { SEQUENTIAL_COLOR } from '@/lib/buddyx/chartColors';
import type { CoverageFigures, IntegrityFlag, IntegritySummary } from '@/lib/buddyx/analyticsTypes';

/**
 * The integrity layer of Chatter Analytics — admin views only, display only.
 * Every sentence here describes what was measured, never a conclusion about
 * the person: a flag is a lead to look at, and the report shows the minutes
 * behind it (documentation/time-tracking.md §4b).
 */

const MINUTE = 60_000;

/** "Mon 6 Oct, Wed 8 Oct" — at most three, then "+N more". */
function dayList(days: string[]): string {
  if (days.length === 0) return '';
  const shown = days.slice(0, 3).map(formatDayLabelWithWeekday).join(', ');
  return days.length > 3 ? `${shown} +${days.length - 3} more` : shown;
}

/** One flag as a sentence. `withName` off for a single agent's report, where the name is the page. */
export function flagSentence(flag: IntegrityFlag, withName: boolean): string {
  const minutes = formatDuration((flag.minutes ?? 0) * MINUTE);
  const say = (named: string, bare: string) => (withName ? `${flag.name} ${named}` : bare);
  switch (flag.kind) {
    case 'never-online': {
      const shifts = `${flag.shifts} ${flag.shifts === 1 ? 'shift' : 'shifts'}`;
      return say(`was rostered on ${shifts} and never online in BuddyX`, `Rostered on ${shifts} and never online in BuddyX`);
    }
    case 'low-coverage':
      return say(
        `was online in BuddyX for ${formatShare(flag.ratio)} of clocked working time`,
        `Online in BuddyX for ${formatShare(flag.ratio)} of clocked working time`,
      );
    case 'regular-input':
      return say(`typed on a machine-regular beat for ${minutes}`, `Typed on a machine-regular beat for ${minutes}`);
    case 'modifier-only':
      return say(`pressed only modifier or filler keys for ${minutes}`, `Pressed only modifier or filler keys for ${minutes}`);
    case 'static-screen':
      return withName ? `${flag.name}’s screen was unchanged for ${minutes}` : `Screen unchanged for ${minutes}`;
    case 'input-permission':
      return say(
        'has not allowed Input Monitoring on their Mac — typing rhythm is only partly checked',
        'Input Monitoring not allowed on their Mac — typing rhythm is only partly checked',
      );
  }
}

const SEVERITY_DOT = { high: 'bg-red-400', medium: 'bg-orange-400' } as const;
const SEVERITY_LABEL = { high: 'High', medium: 'Medium' } as const;

/**
 * The ranked flag list — the attention-band recipe (DESIGN.md §5): attention
 * tint, a static dot per line, each line names its subject and offers its way
 * in, and the band states its own empty. Severity is the dot's hue *and* a
 * word for screen readers, never hue alone.
 */
export function FlagList({
  flags,
  withNames,
  hrefFor,
  cleanLine,
}: {
  flags: IntegrityFlag[];
  withNames: boolean;
  hrefFor?: (flag: IntegrityFlag) => string;
  /** The band's own empty, stated in full. */
  cleanLine: string;
}) {
  if (flags.length === 0) {
    return <p className="text-sm text-zinc-400">{cleanLine}</p>;
  }
  return (
    <section aria-label="Flags" className="rounded-xl border border-orange-500/20 bg-orange-500/[0.06] px-4 py-3">
      <ul className="space-y-1.5">
        {flags.map((f, i) => {
          const days = dayList(f.days);
          const sentence = flagSentence(f, withNames);
          return (
            <li key={`${f.uid}-${f.kind}-${i}`} className="flex items-start gap-2 text-sm">
              <span className={cn('mt-[7px] inline-block size-1.5 shrink-0 rounded-full', SEVERITY_DOT[f.severity])} aria-hidden />
              <span className="sr-only">{SEVERITY_LABEL[f.severity]}:</span>
              <span className="min-w-0">
                {hrefFor ? (
                  <Link href={hrefFor(f)} prefetch={false} className="underline-offset-2 hover:text-white hover:underline">
                    {sentence}
                  </Link>
                ) : (
                  sentence
                )}
                {days && <span className="text-[11px] text-zinc-400"> · {days}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The agent's own coverage, as one bar: the track is clocked working time, the
 * fill is the part of it they were online in BuddyX. A fact, with no
 * threshold drawn — the agent view carries no flags.
 */
export function CoverageMeter({ coverage }: { coverage: CoverageFigures }) {
  const share = coverage.ratio ?? 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="text-lg font-semibold tabular-nums">{formatShare(coverage.ratio)}</span>
          <span className="text-zinc-400"> of your clocked working time online in BuddyX</span>
        </p>
        <p className="text-[11px] text-zinc-400 tabular-nums">
          {formatDuration(coverage.onlineWhileClockedMs)} of {formatDuration(coverage.clockedMs)}
        </p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]"
        role="img"
        aria-label={`Online in BuddyX for ${formatShare(coverage.ratio)} of clocked working time: ${formatDuration(coverage.onlineWhileClockedMs)} of ${formatDuration(coverage.clockedMs)}.`}
      >
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: SEQUENTIAL_COLOR }} />
      </div>
      {coverage.approximateDays > 0 && (
        <p className="mt-1.5 text-[11px] text-zinc-400">
          {coverage.approximateDays} {coverage.approximateDays === 1 ? 'day is' : 'days are'} judged on daily totals — hour-by-hour BuddyX data is still filling in.
        </p>
      )}
    </div>
  );
}

/** "Monitored 6h 40m · 3 of 26 captures unchanged" — what the integrity numbers rest on. */
export function integrityBasis(integrity: IntegritySummary | null): string {
  if (!integrity) return 'Not monitored';
  const parts = [`Monitored ${formatDuration(integrity.monitoredMinutes * MINUTE)}`];
  if (integrity.comparedCaptures > 0) parts.push(`${integrity.unchangedCaptures} of ${integrity.comparedCaptures} captures unchanged`);
  return parts.join(' · ');
}
