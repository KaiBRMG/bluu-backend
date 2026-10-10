'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SURFACE, SURFACE_INTERACTIVE } from '@/lib/surfaces';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PersonTag } from '@/components/disputes/disputeUi';
import { LegendSwatch, SEGMENT } from '@/components/buddyx/buddyxUi';
import { flagSentence } from '@/components/buddyx/integrityUi';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatDuration, formatRate, formatShare } from '@/lib/buddyx/analyticsFormat';
import { SEQUENTIAL_COLOR } from '@/lib/buddyx/chartColors';
import { COVERAGE_FLAG_RATIO } from '@/lib/buddyx/coverage';
import type { ChatterLeaderboardRow, IntegrityFlag, ReportDay } from '@/lib/buddyx/analyticsTypes';

/**
 * The admin roster — **one card per agent**, each with its own small chart, so
 * the whole team reads as a wall of comparable pictures rather than one chart
 * or one wide table (DESIGN.md §5, the agent roster).
 *
 * Every figure is **interpreted**: coverage as a sentence, and each
 * performance figure as where it sits among the team ("top quarter", "below
 * median"). A raw "$41 / online h" means nothing until you know the team's
 * middle is $63. Display only — nothing here feeds pay.
 */

const DAY_MIN_CLOCKED_MS = 30 * 60_000;
/** Past this many days a bar per day is a comb; the chart switches to weeks. */
const MAX_DAY_BARS = 35;

// ─── Ranking against the team ────────────────────────────────────────

export type Rank = 'top' | 'above' | 'below' | 'bottom';

const RANK_WORD: Record<Rank, string> = {
  top: 'Top quarter',
  above: 'Above median',
  below: 'Below median',
  bottom: 'Bottom quarter',
};
/** Only the ends carry a hue — the middle half is ordinary and stays grey. */
const RANK_TONE: Record<Rank, string> = {
  top: 'text-green-400',
  above: 'text-zinc-400',
  below: 'text-zinc-400',
  bottom: 'text-orange-400',
};

/**
 * Where a value sits among the team's values: the share of the *other* agents
 * it does better than. Null below three agents with a figure — with two, the
 * "team median" is just the other person.
 */
function rankAmong(value: number | null, peers: number[], lowerIsBetter: boolean): Rank | null {
  if (value === null || peers.length < 3) return null;
  const others = peers.length - 1;
  const beaten = peers.filter(p => (lowerIsBetter ? p > value : p < value)).length;
  const share = beaten / others;
  if (share >= 0.75) return 'top';
  if (share >= 0.5) return 'above';
  if (share > 0.25) return 'below';
  return 'bottom';
}

type MetricKey = 'revenuePerOnlineHour' | 'medianResponseTimeMs' | 'unlockRate' | 'gross' | 'coverage';

const METRICS: Record<MetricKey, { label: string; lowerIsBetter: boolean; value: (r: ChatterLeaderboardRow) => number | null; format: (v: number) => string }> = {
  coverage: { label: 'Coverage', lowerIsBetter: false, value: r => r.coverage?.ratio ?? null, format: v => formatShare(v) },
  gross: { label: 'Gross', lowerIsBetter: false, value: r => r.ppvGross + r.tipsGross, format: v => formatUsd(v) },
  revenuePerOnlineHour: { label: 'Gross / online hour', lowerIsBetter: false, value: r => r.revenuePerOnlineHour, format: v => formatUsd(v) },
  medianResponseTimeMs: { label: 'Reply time', lowerIsBetter: true, value: r => r.medianResponseTimeMs, format: v => formatDuration(v) },
  unlockRate: { label: 'Unlock rate', lowerIsBetter: false, value: r => r.unlockRate, format: v => formatRate(v, 1) },
};

function useTeamRanks(rows: ChatterLeaderboardRow[]) {
  return useMemo(() => {
    const peers = Object.fromEntries(
      (Object.keys(METRICS) as MetricKey[]).map(k => [
        k,
        rows.map(r => METRICS[k].value(r)).filter((v): v is number => v !== null && Number.isFinite(v)),
      ]),
    ) as Record<MetricKey, number[]>;
    return (row: ChatterLeaderboardRow, key: MetricKey) => rankAmong(METRICS[key].value(row), peers[key], METRICS[key].lowerIsBetter);
  }, [rows]);
}

// ─── The verdict ─────────────────────────────────────────────────────

const SEVERITY_ORDER = { high: 0, medium: 1 } as const;

function attentionOf(flags: IntegrityFlag[]): 'high' | 'medium' | null {
  if (flags.some(f => f.severity === 'high')) return 'high';
  return flags.length > 0 ? 'medium' : null;
}

/** The agent's period in one or two plain sentences: coverage first, then any other flag. */
function verdict(row: ChatterLeaderboardRow, flags: IntegrityFlag[]): string {
  const never = flags.find(f => f.kind === 'never-online');
  const parts: string[] = [];
  const cov = row.coverage;
  if (never) {
    parts.push(`${flagSentence(never, false)}.`);
  } else if (!cov || cov.clockedMs === 0) {
    parts.push((row.onlineMs ?? 0) > 0 ? 'Online in BuddyX but never clocked in this period.' : 'Not clocked in this period.');
  } else {
    const worked = row.days.filter(d => d.clockedMs >= DAY_MIN_CLOCKED_MS);
    const low = worked.filter(d => d.onlineWhileClockedMs / d.clockedMs < COVERAGE_FLAG_RATIO).length;
    const lowNote = low > 0 ? `low on ${low} of ${worked.length} ${worked.length === 1 ? 'day' : 'days'}` : '';
    const ratio = cov.ratio ?? 0;
    if (ratio >= 0.9) parts.push('Online for nearly all clocked time.');
    else if (ratio >= COVERAGE_FLAG_RATIO) parts.push(`Online for most clocked time${lowNote ? `, but ${lowNote}` : ''}.`);
    else parts.push(`Online for only ${formatShare(ratio)} of clocked time${lowNote ? ` — ${lowNote}` : ''}.`);
  }
  for (const f of flags) {
    if (f.kind === 'never-online' || f.kind === 'low-coverage') continue;
    parts.push(`${flagSentence(f, false)}.`);
  }
  return parts.join(' ');
}

// ─── The small chart ─────────────────────────────────────────────────

type Bucket = { label: string; title: string; clockedMs: number; onlineMs: number };

/** Days, or whole weeks once a period is long enough that a bar per day turns into a comb. */
function bucketsFor(days: ReportDay[], byWeek: boolean): Bucket[] {
  if (!byWeek) {
    return days.map(d => ({
      label: 'SMTWTFS'[new Date(`${d.day}T12:00:00Z`).getUTCDay()],
      title: formatDayLabelWithWeekday(d.day),
      clockedMs: d.clockedMs,
      onlineMs: d.onlineWhileClockedMs,
    }));
  }
  const out: Bucket[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    out.push({
      label: '',
      title: `Week of ${formatDayLabelWithWeekday(week[0].day)}`,
      clockedMs: week.reduce((s, d) => s + d.clockedMs, 0),
      onlineMs: week.reduce((s, d) => s + d.onlineWhileClockedMs, 0),
    });
  }
  return out;
}

/**
 * One bar per day (or week), on a scale shared by every card so two agents can
 * be compared by eye. The bar's height is clocked working time; the blue part
 * is the share of it spent online in BuddyX, so the grey above it is the gap.
 * Grey is zinc-500 (3.7:1 on the card) and blue the validated sequential hue
 * (4.3:1) — both clear the 3:1 floor for marks that carry meaning.
 */
function CoverageBars({ buckets, maxMs, name }: { buckets: Bucket[]; maxMs: number; name: string }) {
  const showLabels = buckets.length <= 14 && buckets.every(b => b.label);
  const lowest = buckets
    .filter(b => b.clockedMs >= DAY_MIN_CLOCKED_MS)
    .sort((a, b) => a.onlineMs / a.clockedMs - b.onlineMs / b.clockedMs)[0];
  const summary = lowest
    ? `${name}: lowest ${lowest.title}, online ${formatShare(lowest.onlineMs / lowest.clockedMs)} of ${formatDuration(lowest.clockedMs)} clocked.`
    : `${name}: no clocked time in this period.`;
  return (
    <div role="img" aria-label={summary}>
      <div className="flex h-14 items-end gap-[3px]">
        {buckets.map((b, i) => {
          const h = maxMs > 0 ? (b.clockedMs / maxMs) * 100 : 0;
          const fill = b.clockedMs > 0 ? Math.min(100, (b.onlineMs / b.clockedMs) * 100) : 0;
          return (
            <div
              key={i}
              className="relative flex-1"
              style={{ height: b.clockedMs > 0 ? `${Math.max(6, h)}%` : 2 }}
              title={
                b.clockedMs > 0
                  ? `${b.title}: online ${formatDuration(b.onlineMs)} of ${formatDuration(b.clockedMs)} clocked (${formatShare(b.onlineMs / b.clockedMs)})`
                  : `${b.title}: not clocked in`
              }
            >
              <div className={cn('absolute inset-0 rounded-t-[2px]', b.clockedMs > 0 ? 'bg-zinc-500' : 'bg-white/[0.1]')} />
              {fill > 0 && (
                <div className="absolute inset-x-0 bottom-0 rounded-t-[2px]" style={{ height: `${fill}%`, background: SEQUENTIAL_COLOR }} />
              )}
            </div>
          );
        })}
      </div>
      {showLabels && (
        <div className="mt-1 flex gap-[3px] text-center text-[10px] text-zinc-400" aria-hidden>
          {buckets.map((b, i) => <span key={i} className="flex-1">{b.label}</span>)}
        </div>
      )}
    </div>
  );
}

// ─── The roster ──────────────────────────────────────────────────────

type RosterSort = 'attention' | 'coverage' | 'revenue' | 'name';

const SORTS: Array<{ value: RosterSort; label: string }> = [
  { value: 'attention', label: 'Needs a look first' },
  { value: 'coverage', label: 'Lowest coverage' },
  { value: 'revenue', label: 'Highest gross' },
  { value: 'name', label: 'Name' },
];

const ATTENTION_LABEL = { high: 'Needs a look', medium: 'Worth a look' } as const;
const ATTENTION_DOT = { high: 'bg-red-400', medium: 'bg-orange-400' } as const;

export function AgentRoster({
  rows,
  flagsByUid,
  hrefFor,
}: {
  rows: ChatterLeaderboardRow[];
  flagsByUid: Map<string, IntegrityFlag[]>;
  hrefFor: (uid: string) => string;
}) {
  const [sort, setSort] = useState<RosterSort>('attention');
  const agents = useMemo(() => rows.filter(r => r.uid), [rows]);
  const rankOf = useTeamRanks(agents);

  const byWeek = (agents[0]?.days.length ?? 0) > MAX_DAY_BARS;
  const bucketsByUid = useMemo(
    () => new Map(agents.map(r => [r.uid!, bucketsFor(r.days, byWeek)] as const)),
    [agents, byWeek],
  );
  const maxMs = useMemo(
    () => Math.max(0, ...[...bucketsByUid.values()].flatMap(bs => bs.map(b => b.clockedMs))),
    [bucketsByUid],
  );

  const sorted = useMemo(() => {
    const severity = (r: ChatterLeaderboardRow) => {
      const a = attentionOf(flagsByUid.get(r.uid!) ?? []);
      return a ? SEVERITY_ORDER[a] : 2;
    };
    const coverage = (r: ChatterLeaderboardRow) => r.coverage?.ratio ?? Infinity;
    return [...agents].sort((a, b) => {
      switch (sort) {
        case 'attention':
          return severity(a) - severity(b) || coverage(a) - coverage(b) || a.name.localeCompare(b.name);
        case 'coverage':
          return coverage(a) - coverage(b) || a.name.localeCompare(b.name);
        case 'revenue':
          return b.ppvGross + b.tipsGross - (a.ppvGross + a.tipsGross);
        case 'name':
          return a.name.localeCompare(b.name);
      }
    });
  }, [agents, sort, flagsByUid]);

  if (agents.length === 0) return <p className="text-sm text-zinc-400">No agents with activity or shifts in this period.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400" aria-hidden>
          <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SEQUENTIAL_COLOR} /> Online while clocked in</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-[3px] bg-zinc-500" /> Clocked, not online</span>
          <span>Bar height = clocked time, {byWeek ? 'per week' : 'per day'}, same scale on every card</span>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={sort} onValueChange={v => v && setSort(v as RosterSort)} aria-label="Sort agents">
          {SORTS.map(s => <ToggleGroupItem key={s.value} value={s.value} className={SEGMENT}>{s.label}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {sorted.map(r => {
          const flags = flagsByUid.get(r.uid!) ?? [];
          const attention = attentionOf(flags);
          const ratio = r.coverage?.ratio ?? null;
          return (
            <li key={r.uid}>
              <Link
                href={hrefFor(r.uid!)}
                prefetch={false}
                className={cn('flex h-full flex-col gap-3 rounded-xl p-4', SURFACE, SURFACE_INTERACTIVE)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <PersonTag name={r.name} photoURL={null} size="sm" />
                    {attention && (
                      <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-zinc-300">
                        <span className={cn('inline-block size-1.5 rounded-full', ATTENTION_DOT[attention])} aria-hidden />
                        {ATTENTION_LABEL[attention]}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={cn('text-lg font-semibold leading-none tabular-nums', ratio !== null && ratio < COVERAGE_FLAG_RATIO && 'text-orange-400')}>
                      {formatShare(ratio)}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-400">online while clocked</div>
                  </div>
                </div>

                <CoverageBars buckets={bucketsByUid.get(r.uid!) ?? []} maxMs={maxMs} name={r.name} />

                <p className="text-[13px] leading-snug text-zinc-300">{verdict(r, flags)}</p>

                <dl className="mt-auto grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 gap-y-1 border-t border-white/[0.07] pt-3 text-xs">
                  {(['revenuePerOnlineHour', 'medianResponseTimeMs', 'unlockRate'] as const).map(k => {
                    const v = METRICS[k].value(r);
                    const rank = rankOf(r, k);
                    return (
                      <div key={k} className="contents">
                        <dt className="text-zinc-400">{METRICS[k].label}</dt>
                        <dd className="text-right tabular-nums">{v === null ? '—' : METRICS[k].format(v)}</dd>
                        <dd className={cn('text-right text-[11px]', rank ? RANK_TONE[rank] : 'text-zinc-400')}>{rank ? RANK_WORD[rank] : '—'}</dd>
                      </div>
                    );
                  })}
                </dl>

                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span className="tabular-nums">
                    {formatUsd(r.ppvGross + r.tipsGross)} gross · {r.accounts} {r.accounts === 1 ? 'account' : 'accounts'}
                  </span>
                  <span className="inline-flex items-center gap-1">Report <ArrowRight className="size-3" aria-hidden /></span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── The compact comparison table ────────────────────────────────────

const TABLE_COLUMNS: MetricKey[] = ['coverage', 'gross', 'revenuePerOnlineHour', 'medianResponseTimeMs', 'unlockRate'];
const HEAD = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-400';

/**
 * Five figures, every one with its place among the team underneath it — the
 * roster's figures side by side for sorting, not a dump of every metric (the
 * report has those). The whole row opens the report; the name link is the
 * keyboard route. Unlinked BuddyX chatters appear here only.
 */
export function CompareTable({ rows, hrefFor }: { rows: ChatterLeaderboardRow[]; hrefFor: (uid: string) => string }) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: MetricKey; desc: boolean }>({ key: 'coverage', desc: false });
  const rankOf = useTeamRanks(useMemo(() => rows.filter(r => r.uid), [rows]));
  const sorted = useMemo(() => {
    const val = (r: ChatterLeaderboardRow) => METRICS[sort.key].value(r);
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === null && y === null) return a.name.localeCompare(b.name);
      if (x === null) return 1;
      if (y === null) return -1;
      return sort.desc ? y - x : x - y;
    });
  }, [rows, sort]);

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Agent comparison, scrollable"
      className="overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/[0.07]">
            <th scope="col" className={cn('sticky left-0 z-10 bg-[var(--card)] px-3 py-2.5 text-left', HEAD)}>Agent</th>
            {TABLE_COLUMNS.map(key => {
              const lowerFirst = key === 'coverage' || METRICS[key].lowerIsBetter;
              return (
                <th key={key} scope="col" aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'} className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : !lowerFirst }))}
                    className={cn('inline-flex items-center gap-1 rounded-sm hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', HEAD)}
                  >
                    {METRICS[key].label}
                    {sort.key === key && (sort.desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.045]">
          {sorted.map(r => (
            <tr
              key={r.uid ?? r.chatterId}
              onClick={r.uid ? () => router.push(hrefFor(r.uid!)) : undefined}
              className={cn('group', r.uid && 'cursor-pointer hover:bg-white/[0.055] active:bg-white/[0.08]')}
            >
              <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2 before:absolute before:inset-0 before:transition-colors group-hover:before:bg-white/[0.055]">
                {r.uid ? (
                  <Link
                    href={hrefFor(r.uid)}
                    prefetch={false}
                    onClick={e => e.stopPropagation()}
                    className="relative inline-flex rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-label={`Open ${r.name}’s report`}
                  >
                    <PersonTag name={r.name} photoURL={null} size="sm" />
                  </Link>
                ) : (
                  <span className="relative text-xs text-zinc-400">{r.name}</span>
                )}
              </td>
              {TABLE_COLUMNS.map(key => {
                const v = METRICS[key].value(r);
                const rank = r.uid ? rankOf(r, key) : null;
                return (
                  <td key={key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    <span className={cn(key === 'coverage' && v !== null && v < COVERAGE_FLAG_RATIO && 'text-orange-400')}>
                      {v === null ? '—' : METRICS[key].format(v)}
                    </span>
                    {rank && <span className={cn('block text-[11px]', RANK_TONE[rank])}>{RANK_WORD[rank]}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
