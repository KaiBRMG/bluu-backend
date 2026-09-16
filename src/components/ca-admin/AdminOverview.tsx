'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HAIRLINE, SURFACE } from '@/lib/surfaces';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorAvatar } from '@/components/creators/CreatorChip';
import { MonthPicker } from '@/components/salary/MonthPicker';
import { useAuth } from '@/components/AuthProvider';
import { useCreators } from '@/hooks/useCreators';
import { getCache, setCache } from '@/lib/queryCache';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { formatMonthLabel, formatMonthLabelShort } from '@/lib/salary/salaryDate';
import { formatHours, formatUsd, formatUsdCompact, pluralise, signedMoneyClass } from '@/lib/salary/salaryFormat';

/**
 * The month above the roster: where the revenue came from, and what it cost.
 *
 * Payroll answers "what do I pay this agent". This answers the two questions
 * that only exist one level up — **which creators is the money coming from**,
 * and **is any of it resting on one person**. The agent × creator matrix is the
 * individual sales report's `By creator` breakdown lifted to the whole roster,
 * which is the read it was always missing: an agent's own top creator tells you
 * nothing about whether that creator has anyone else on them.
 *
 * Three deliberate calls:
 *
 * - **Magnitude is drawn against one shared scale, never per row.** Per-row
 *   scaling would make every agent's best creator look equally large, which is
 *   precisely the comparison this page exists to make. The leaderboard keeps
 *   the sales report's bar-behind-the-row; the matrix uses a tint instead,
 *   because a bar inside an 80px column degenerates into slivers — see
 *   `BarCell`. Both ramp from the same Action Blue token.
 * - **Deltas carry no hue.** A month-over-month fall is information, not an
 *   error state, and colouring every row green-or-red spends the palette on the
 *   ordinary case (DESIGN.md §2, and `signedMoneyClass`'s own reasoning). The
 *   few movements that genuinely need acting on are escalated into the
 *   attention band instead, which is the house's own interrupt idiom.
 * - **Month-over-month is gross only, never payroll.** Comparing payroll would
 *   cost a second full month build — six more queries — for a figure nobody
 *   reconciles. The band above the table says so rather than leaving the reader
 *   to assume the comparison is missing.
 *
 * Finalised months are worth knowing about here: their *totals* are frozen
 * while their sales rows stay live, so a late import moves the revenue columns
 * and not the payroll ones. The header strip names how many are frozen.
 */

/** Matches the sales report: long enough to cover flicking between tabs, which
 *  Radix unmounts and would otherwise re-fetch in full every single time. */
const CACHE_TTL_MS = 60 * 1000;

/** Creator columns before the rest fold into `Other`. Ten fits the 1024px
 *  window floor with the agent and total columns; past that the matrix is a
 *  spreadsheet, and the leaderboard below answers the long tail better. */
const DEFAULT_CREATOR_COLUMNS = 10;

interface OverviewAgent {
  uid: string;
  displayName: string;
  photoURL: string | null;
  gross: number;
  commission: number;
  wage: number;
  salary: number;
  hours: number;
  saleCount: number;
  tierPercent: number | null;
  status: 'open' | 'finalized';
  overriddenDays: number;
  missingShiftDays: number;
  byCreator: Record<string, number>;
  /** Accounts on this agent's own shifts this month — the roster, not the sales. */
  accountCount: number;
  /** Accounts they covered for someone else and hold none of themselves. */
  coverAccountCount: number;
  previousGross: number | null;
}

interface OverviewCreator {
  name: string;
  gross: number;
  count: number;
  /** Agents who recorded a sale on this creator — a revenue fact. */
  agentCount: number;
  /** Agents rostered onto this creator — a coverage fact. `null` when unreadable. */
  assignedAgentCount: number | null;
  previousGross: number | null;
}

interface OverviewResponse {
  month: string;
  previousMonth: string;
  agents: OverviewAgent[];
  creators: OverviewCreator[];
  totals: {
    gross: number;
    previousGross: number;
    commission: number;
    wage: number;
    payroll: number;
    hours: number;
    saleCount: number;
    agentCount: number;
    earningAgentCount: number;
    creatorCount: number;
    finalizedCount: number;
    overriddenDays: number;
    missingShiftDays: number;
  };
  attention: {
    agentsWithoutSales: Array<{ uid: string; displayName: string }>;
    lapsedCreators: Array<{ name: string; previousGross: number }>;
    /** Exactly one agent *rostered* on the account — see the route's note. */
    soloCreators: Array<{ name: string; gross: number; agentName: string }>;
    /** Earning creators whose coverage could not be read. `matched` false = the name is not on the roster. */
    unmeasuredCreators: Array<{ name: string; gross: number; matched: boolean }>;
  };
}

export default function AdminOverview({ month, onMonthChange }: { month: string; onMonthChange: (month: string) => void }) {
  const { user } = useAuth();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      if (!user) return;

      // v2: the agent rows gained `accountCount`/`coverAccountCount`. A v1 entry
      // is shape-incompatible — the sub-label would render "undefined accounts"
      // off it — so the version is bumped rather than the fields defaulted.
      const key = `bluu_ca_overview_v2:${user.uid}:${month}`;
      if (!force) {
        const cached = getCache<OverviewResponse>(key, CACHE_TTL_MS);
        if (cached) {
          setData(cached);
          setLoading(false);
          setError(null);
          return;
        }
      }

      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/ca-salary/overview?month=${month}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          let message = `Could not load the overview (${res.status})`;
          try {
            const body = await res.json();
            if (body?.error) message = body.error;
          } catch {
            /* keep the status-based message */
          }
          throw new Error(message);
        }
        const body = (await res.json()) as OverviewResponse;
        setCache(key, body);
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the overview');
      } finally {
        setLoading(false);
      }
    },
    [user, month],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Revenue and payroll</h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            {data
              ? `${formatUsd(data.totals.gross)} earned across ${pluralise(data.totals.creatorCount, 'creator')}`
              : 'Where the month’s money came from, and what it cost to run'}
          </p>
        </div>
        <MonthPicker month={month} onChange={onMonthChange} />
      </div>

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      )}

      {error && !loading && (
        <div className="space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void load(true)}>
            <RotateCcw className="size-3.5" aria-hidden />
            Try again
          </Button>
        </div>
      )}

      {data && !loading && <Overview data={data} />}
    </div>
  );
}

function Overview({ data }: { data: OverviewResponse }) {
  const { totals, agents, creators, attention } = data;

  if (totals.agentCount === 0) {
    return (
      <p className="text-sm text-zinc-400">
        No chat agents found. Add users to the CA group in User Management to see them here.
      </p>
    );
  }

  const hasRevenue = creators.length > 0;

  return (
    <div className="space-y-5">
      <HeadlineStrip data={data} />

      <AttentionBand attention={attention} totals={totals} previousMonth={data.previousMonth} />

      {hasRevenue ? (
        <>
          <EarningsMatrix agents={agents} creators={creators} month={data.month} />
          <CreatorLeaderboard creators={creators} totalGross={totals.gross} previousMonth={data.previousMonth} />
        </>
      ) : (
        <div className={cn('rounded-xl p-6 text-center', SURFACE)}>
          <p className="text-sm font-medium">No sales imported for {formatMonthLabel(data.month)}.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
            The breakdown by creator is built from the sales export. Upload this month’s <code>.xlsx</code> on the{' '}
            <span className="text-foreground">Sales data</span> tab and it will appear here.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── The five numbers ────────────────────────────────────────────────

/**
 * What the month earned and what it cost, read before anything is filtered.
 *
 * Payroll share is the one figure here that is not on any other screen, and it
 * is the reason the strip is worth its space: gross and payroll each mean
 * something only next to the other.
 */
function HeadlineStrip({ data }: { data: OverviewResponse }) {
  const { totals } = data;
  const share = totals.gross > 0 ? (totals.payroll / totals.gross) * 100 : null;

  return (
    <section className={cn('rounded-xl p-4', SURFACE)} aria-label="Month totals">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <Metric
          label="Gross revenue"
          value={formatUsd(totals.gross)}
          emphasis
          meta={<Delta current={totals.gross} previous={totals.previousGross} month={data.previousMonth} />}
        />
        <Metric
          label="Payroll cost"
          value={formatUsd(totals.payroll)}
          emphasis
          meta={
            <span className="text-xs text-zinc-400">
              {formatUsd(totals.commission, { cents: false })} commission ·{' '}
              {formatUsd(totals.wage, { cents: false })} hourly
            </span>
          }
        />
        <Metric
          label="Payroll share"
          value={share === null ? '—' : `${share.toFixed(1)}%`}
          meta={<span className="text-xs text-zinc-400">{share === null ? 'No revenue yet' : 'of gross revenue'}</span>}
        />
        <Metric
          label="Hours worked"
          value={formatHours(totals.hours)}
          meta={<span className="text-xs text-zinc-400">{pluralise(totals.saleCount, 'sale')} recorded</span>}
        />
        <Metric
          label="Agents earning"
          value={`${totals.earningAgentCount} of ${totals.agentCount}`}
          meta={
            <span className="text-xs text-zinc-400">
              {totals.finalizedCount > 0 ? `${totals.finalizedCount} finalised` : 'None finalised'}
            </span>
          }
        />
      </dl>
    </section>
  );
}

function Metric({
  label,
  value,
  meta,
  emphasis,
}: {
  label: string;
  value: string;
  meta?: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className={cn('mt-0.5 font-semibold tabular-nums', emphasis ? 'text-xl' : 'text-lg')}>{value}</dd>
      {meta && <div className="mt-0.5">{meta}</div>}
    </div>
  );
}

/**
 * A month-over-month movement, stated without a hue.
 *
 * `previous` of `0` or less cannot produce a meaningful percentage — the honest
 * answer there is "nothing to compare against", not an infinity. A figure that
 * exists now and did not last month reads "New", which is a different fact from
 * "up 100%" and the one an admin actually wants.
 */
function Delta({ current, previous, month }: { current: number; previous: number | null; month: string }) {
  if (previous === null || previous <= 0) {
    return (
      <span className="text-xs text-zinc-400">
        {current > 0 ? `New since ${formatMonthLabelShort(month)}` : `Nothing in ${formatMonthLabelShort(month)}`}
      </span>
    );
  }

  const change = ((current - previous) / previous) * 100;
  const flat = Math.abs(change) < 0.5;
  const Icon = change < 0 ? TrendingDown : TrendingUp;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
      {!flat && <Icon className="size-3 shrink-0" aria-hidden />}
      <span className="tabular-nums">
        {flat ? 'Level with' : `${change < 0 ? '−' : '+'}${Math.abs(change).toFixed(1)}% on`}{' '}
        {formatMonthLabelShort(month)}
      </span>
    </span>
  );
}

// ─── What is worth interrupting for ──────────────────────────────────

/**
 * The few things in this month that need somebody to look at them.
 *
 * Takes the app's *attention needed* tint and no motion, per the interrupt-band
 * rule in DESIGN.md §5 — a pulse on a console people sit in front of for eight
 * hours trains them to stop seeing it. Each line names its rows rather than
 * reporting a count the reader then has to go hunting for, and the band states
 * plainly when there is nothing: a check that disappears when it passes is
 * indistinguishable from a check that never ran.
 */
function AttentionBand({
  attention,
  totals,
  previousMonth,
}: {
  attention: OverviewResponse['attention'];
  totals: OverviewResponse['totals'];
  previousMonth: string;
}) {
  const findings: Array<{ key: string; text: React.ReactNode }> = [];

  if (totals.missingShiftDays > 0) {
    findings.push({
      key: 'missing-shift',
      text: (
        <>
          <strong className="font-medium text-foreground">
            {pluralise(totals.missingShiftDays, 'day')} with sales but no shift
          </strong>{' '}
          — hours could not be derived, so the hourly pay on those days is probably wrong. Open the agent in Payroll to
          see which.
        </>
      ),
    });
  }

  if (attention.agentsWithoutSales.length > 0) {
    findings.push({
      key: 'no-sales',
      text: (
        <>
          <strong className="font-medium text-foreground">No sales recorded</strong> for{' '}
          {attention.agentsWithoutSales.map(a => a.displayName).join(', ')} — either they did not work, or their rows
          failed to map to an account on import.
        </>
      ),
    });
  }

  if (attention.soloCreators.length > 0) {
    findings.push({
      key: 'solo',
      text: (
        <>
          <strong className="font-medium text-foreground">
            {pluralise(attention.soloCreators.length, 'creator')} with only one agent rostered on them
          </strong>{' '}
          — {attention.soloCreators.slice(0, 4).map(c => `${c.name} (${c.agentName})`).join(', ')}
          {attention.soloCreators.length > 4 && `, and ${attention.soloCreators.length - 4} more`}. An absence there has
          nobody to fall back on.
        </>
      ),
    });
  }

  if (attention.unmeasuredCreators.length > 0) {
    findings.push({
      key: 'unmeasured',
      text: (
        <>
          <strong className="font-medium text-foreground">
            Coverage unknown for {pluralise(attention.unmeasuredCreators.length, 'earning creator')}
          </strong>{' '}
          — {attention.unmeasuredCreators.slice(0, 4).map(c => c.name).join(', ')}
          {attention.unmeasuredCreators.length > 4 && `, and ${attention.unmeasuredCreators.length - 4} more`}.{' '}
          {attention.unmeasuredCreators.some(c => !c.matched)
            ? 'Some of these names do not match a creator on the roster, so sales and shifts cannot be joined.'
            : 'No shift this month records an assignment for them.'}{' '}
          The solo-coverage check above skips these rows.
        </>
      ),
    });
  }

  if (attention.lapsedCreators.length > 0) {
    findings.push({
      key: 'lapsed',
      text: (
        <>
          <strong className="font-medium text-foreground">
            {pluralise(attention.lapsedCreators.length, 'creator')} earned in {formatMonthLabelShort(previousMonth)} and
            nothing this month
          </strong>{' '}
          — {attention.lapsedCreators.slice(0, 4).map(c => `${c.name} (${formatUsdCompact(c.previousGross)})`).join(', ')}
          {attention.lapsedCreators.length > 4 && `, and ${attention.lapsedCreators.length - 4} more`}.
        </>
      ),
    });
  }

  if (totals.overriddenDays > 0) {
    findings.push({
      key: 'overrides',
      text: (
        <>
          <strong className="font-medium text-foreground">
            {pluralise(totals.overriddenDays, 'day')} edited by an administrator
          </strong>{' '}
          — those figures no longer follow from the sales and shifts behind them.
        </>
      ),
    });
  }

  if (findings.length === 0) {
    return (
      <p className={cn('rounded-lg px-3 py-2 text-sm text-zinc-400', SURFACE)}>
        Nothing to check — every agent has sales, every day with sales has a shift, and no creator is resting on a
        single agent.
      </p>
    );
  }

  return (
    <section
      className="rounded-lg border border-orange-500/20 bg-orange-500/[0.06] p-3"
      aria-label={`${pluralise(findings.length, 'thing')} to check`}
    >
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-orange-400">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        {pluralise(findings.length, 'thing')} to check
      </h3>
      <ul className="mt-2 space-y-1.5">
        {findings.map(finding => (
          <li key={finding.key} className="flex gap-2 text-sm text-zinc-400">
            <span aria-hidden className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-orange-400" />
            <span className="min-w-0">{finding.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── The matrix ──────────────────────────────────────────────────────

/**
 * Every agent's month, split by the creator the money came from.
 *
 * One shared magnitude scale across the whole grid, so a cell can be compared both
 * along its row (which creator is this agent's earner) and down its column
 * (which agent carries this creator). Normalising per row would destroy the
 * second read, which is the one that is not already available anywhere else.
 *
 * The agent column is sticky because the grid scrolls sideways at the 1024px
 * window floor, and a matrix whose row labels scroll away is unreadable. It
 * paints its own hover overlay through a pseudo-element: the sticky cell needs
 * an opaque background to cover the cells passing beneath it, and an opaque
 * background cannot also show the row's translucent hover wash.
 */
function EarningsMatrix({
  agents,
  creators,
  month,
}: {
  agents: OverviewAgent[];
  creators: OverviewCreator[];
  month: string;
}) {
  const [showAll, setShowAll] = useState(false);

  const shown = showAll ? creators : creators.slice(0, DEFAULT_CREATOR_COLUMNS);
  const folded = creators.slice(shown.length);

  const photoByName = useCreatorPhotos();

  // One scale for every cell, including the folded `Other` column — a bar that
  // sums several creators is legitimately longer, and pretending otherwise
  // would understate the tail.
  const scale = useMemo(() => {
    let max = 0;
    for (const agent of agents) {
      for (const creator of shown) max = Math.max(max, Math.abs(agent.byCreator[creator.name] ?? 0));
      const other = folded.reduce((sum, c) => sum + (agent.byCreator[c.name] ?? 0), 0);
      max = Math.max(max, Math.abs(other));
    }
    return max || 1;
  }, [agents, shown, folded]);

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight">Earnings by agent and creator</h3>
        <p className="text-xs text-zinc-400">
          Gross for {formatMonthLabel(month)}. Shading is the share of the grid’s largest figure.
        </p>
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label="Earnings by agent and creator, scrollable"
        className={cn(
          'overflow-x-auto rounded-lg border',
          HAIRLINE,
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
        )}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className={cn('border-b', HAIRLINE)}>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-content-bg px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
              >
                Agent
              </th>
              {shown.map(creator => (
                <th
                  key={creator.name}
                  scope="col"
                  className="px-2.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
                  title={creator.name}
                >
                  <span className="flex items-center justify-end gap-1.5">
                    <CreatorAvatar name={creator.name} photoURL={photoByName.get(normalise(creator.name)) ?? null} className="size-4 text-[10px]" />
                    <span className="max-w-[6.5rem] truncate normal-case">{creator.name}</span>
                  </span>
                </th>
              ))}
              {folded.length > 0 && (
                <th
                  scope="col"
                  className="px-2.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
                  title={folded.map(c => c.name).join(', ')}
                >
                  {folded.length} more
                </th>
              )}
              <th
                scope="col"
                className={cn('border-l px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400', HAIRLINE)}
              >
                Total
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.045]">
            {agents.map(agent => {
              const otherGross = folded.reduce((sum, c) => sum + (agent.byCreator[c.name] ?? 0), 0);

              // How many accounts the agent *works*, from the roster — not how
              // many produced sales. This read "1 creator" for an agent on four
              // accounts where one sold, which is a different fact wearing the
              // same words. The bars along the row already say which creators
              // earned; the sub-label is the denominator you read them against.
              const accounts =
                agent.accountCount === 0
                  ? 'No accounts'
                  : pluralise(agent.accountCount, 'account');
              // Cover is somebody else's account for a day, so it is named
              // separately rather than folded into the roster count.
              const cover = agent.coverAccountCount > 0 ? ` · +${agent.coverAccountCount} covered` : '';
              const noSales = agent.saleCount === 0 ? ' · no sales' : '';

              return (
                <tr key={agent.uid} className="group transition-colors duration-[120ms] hover:bg-white/[0.055]">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-content-bg px-3 py-2 text-left font-normal before:absolute before:inset-0 before:bg-white/[0.055] before:opacity-0 before:transition-opacity before:duration-[120ms] group-hover:before:opacity-100"
                  >
                    <span className="relative flex items-center gap-2">
                      <Avatar className="size-6 shrink-0">
                        <AvatarImage src={agent.photoURL ?? undefined} alt="" />
                        <AvatarFallback
                          className="text-[10px] font-medium text-white"
                          style={{ backgroundColor: getAvatarColor(agent.displayName) }}
                        >
                          {getInitials(agent.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block max-w-[11rem] truncate font-medium">{agent.displayName}</span>
                        <span className="text-xs text-zinc-400">
                          {`${accounts}${cover}${noSales}`}
                        </span>
                      </span>
                    </span>
                  </th>

                  {shown.map(creator => (
                    <BarCell key={creator.name} value={agent.byCreator[creator.name]} scale={scale} />
                  ))}
                  {folded.length > 0 && <BarCell value={otherGross || undefined} scale={scale} />}

                  <td className={cn('whitespace-nowrap border-l px-3 py-2 text-right font-medium tabular-nums', HAIRLINE)}>
                    {formatUsd(agent.gross)}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t border-white/[0.12] bg-white/[0.02] font-semibold">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-content-bg px-3 py-2.5 text-left text-[11px] uppercase tracking-wide text-zinc-400 before:absolute before:inset-0 before:bg-white/[0.02]"
              >
                <span className="relative">All agents</span>
              </th>
              {shown.map(creator => (
                <td key={creator.name} className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums">
                  {formatUsdCompact(creator.gross)}
                </td>
              ))}
              {folded.length > 0 && (
                <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums">
                  {formatUsdCompact(folded.reduce((sum, c) => sum + c.gross, 0))}
                </td>
              )}
              <td className={cn('whitespace-nowrap border-l px-3 py-2.5 text-right tabular-nums', HAIRLINE)}>
                {formatUsd(agents.reduce((sum, a) => sum + a.gross, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {folded.length > 0 && !showAll && (
        <Button size="xs" variant="ghost" onClick={() => setShowAll(true)} className="-ml-2 text-zinc-400">
          Show all {creators.length} creators
        </Button>
      )}
      {showAll && creators.length > DEFAULT_CREATOR_COLUMNS && (
        <Button size="xs" variant="ghost" onClick={() => setShowAll(false)} className="-ml-2 text-zinc-400">
          Show top {DEFAULT_CREATOR_COLUMNS} only
        </Button>
      )}
    </section>
  );
}

/**
 * One cell: a proportional bar behind a figure.
 *
 * `undefined` and `0` are different facts and render differently — an agent who
 * never touched this creator gets an em dash with no bar, while one who netted
 * out to zero (a sale fully reversed) gets the figure, because that zero is a
 * thing that happened.
 *
 * The figure is compact so ten columns fit, and `formatUsdCompact` is explicitly
 * not for anything that has to be reconciled — so the cell carries the exact
 * amount as its title, and the two columns anyone actually reconciles against
 * (the row total, and the creator's gross in the leaderboard) are never
 * rounded.
 *
 * **Magnitude is a wash here, not a bar** — the one place in this file that
 * departs from the sales report's idiom, and it is the cell width that forces
 * it. A matrix column is ~80px, so a proportional bar renders most of the grid
 * as two- and three-pixel slivers sitting beside a right-aligned number: an
 * encoding nobody can read and a stray mark beside every figure. A tint carries
 * the same ordering at any cell size, which is what a numeric matrix wants. The
 * hue is still the token — `color-mix` against `--action-blue` rather than a
 * hardcoded hex — and it stays semantic, because the only thing it encodes is
 * the value. Reversals ramp red instead, the one meaning red already has here.
 */
function BarCell({ value, scale }: { value: number | undefined; scale: number }) {
  if (value === undefined) {
    return (
      <td className="px-2.5 py-2 text-right tabular-nums text-zinc-400" aria-label="No earnings">
        —
      </td>
    );
  }

  const exact = formatUsd(value);
  // A floor of 4% so the smallest real figure still reads as present rather
  // than as an empty cell, and a ceiling well short of opaque so white text
  // keeps its contrast on the darkest cell in the grid.
  const share = Math.min(1, Math.abs(value) / scale);
  const percent = value === 0 ? 0 : 4 + share * 24;
  const hue = value < 0 ? 'var(--color-red-400)' : 'var(--action-blue)';

  return (
    <td
      className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums"
      title={exact}
      style={percent > 0 ? { backgroundColor: `color-mix(in oklab, ${hue} ${percent}%, transparent)` } : undefined}
    >
      <span className={signedMoneyClass(value)} aria-label={exact}>
        {formatUsdCompact(value)}
      </span>
    </td>
  );
}

// ─── The creator side ────────────────────────────────────────────────

/**
 * Creators ranked by what they brought in, with how many agents stand behind
 * each one.
 *
 * The matrix already carries these totals in its foot; what it cannot show is
 * *share* and *cover*, which are the two things that decide whether a number is
 * comfortable. A creator at 30% of the month with one agent on them is a very
 * different fact from the same 30% split four ways.
 */
function CreatorLeaderboard({
  creators,
  totalGross,
  previousMonth,
}: {
  creators: OverviewCreator[];
  totalGross: number;
  previousMonth: string;
}) {
  const photoByName = useCreatorPhotos();
  const max = Math.max(...creators.map(c => Math.abs(c.gross)), 1);

  const topThree = creators.slice(0, 3).reduce((sum, c) => sum + c.gross, 0);
  const topShare = totalGross > 0 ? (topThree / totalGross) * 100 : 0;

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight">Creators by revenue</h3>
        {totalGross > 0 && creators.length >= 3 && (
          <p className="text-xs text-zinc-400">
            Top three carry <span className="tabular-nums text-foreground">{topShare.toFixed(0)}%</span> of the month
          </p>
        )}
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label="Creators by revenue, scrollable"
        className={cn(
          'overflow-x-auto rounded-lg border',
          HAIRLINE,
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
        )}
      >
        <table className="w-full min-w-[690px] border-collapse text-sm">
          <thead>
            <tr className={cn('border-b', HAIRLINE)}>
              <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Creator
              </th>
              {/* `Sellers` and `Cover` are deliberately two columns, not one
                  "Agents". They are different facts and they disagree all the
                  time: an agent rostered on an account covers it whether or not
                  they closed anything that month. Collapsing them is what made
                  the chip below claim a coverage risk from a revenue number. */}
              {['Gross', 'Share', 'Sales', 'Sellers', 'Cover'].map(label => (
                <th
                  key={label}
                  scope="col"
                  className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
                  title={
                    label === 'Sellers'
                      ? 'Agents who recorded a sale on this creator this month'
                      : label === 'Cover'
                        ? 'Agents rostered onto this creator this month. — means no shift records an assignment.'
                        : undefined
                  }
                >
                  {label}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                vs {formatMonthLabelShort(previousMonth)}
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.045]">
            {creators.map(creator => {
              const share = totalGross > 0 ? (creator.gross / totalGross) * 100 : 0;

              return (
                <tr key={creator.name} className="transition-colors duration-[120ms] hover:bg-white/[0.055]">
                  <th scope="row" className="relative px-3 py-2 text-left font-normal">
                    <span
                      aria-hidden
                      className="absolute inset-y-1 left-1 rounded-sm bg-action-blue/[0.12]"
                      style={{ width: `calc(${(Math.abs(creator.gross) / max) * 100}% - 0.5rem)` }}
                    />
                    <span className="relative flex items-center gap-2">
                      <CreatorAvatar
                        name={creator.name}
                        photoURL={photoByName.get(normalise(creator.name)) ?? null}
                        className="size-6 text-[10px]"
                      />
                      <span className="min-w-0 truncate font-medium">{creator.name}</span>
                      {/* Reads `assignedAgentCount`, not `agentCount`. A lone
                          *seller* is a revenue observation and routinely
                          harmless; a lone *rostered agent* is the thing an
                          absence actually breaks. `null` is unknown, so it
                          earns no chip rather than a false warning — those rows
                          are named in the attention band instead. */}
                      {creator.assignedAgentCount === 1 && creator.gross > 0 && (
                        <span
                          className="shrink-0 rounded-full bg-orange-500/10 px-1.5 py-px text-[10px] font-medium text-orange-400"
                          title="Only one agent is rostered on this account this month"
                        >
                          Sole cover
                        </span>
                      )}
                    </span>
                  </th>

                  <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', signedMoneyClass(creator.gross))}>
                    {formatUsd(creator.gross)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{share.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{creator.count}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{creator.agentCount}</td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      creator.assignedAgentCount === 1 ? 'text-orange-400' : 'text-zinc-400',
                    )}
                  >
                    {creator.assignedAgentCount ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Delta current={creator.gross} previous={creator.previousGross} month={previousMonth} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Creator photos ──────────────────────────────────────────────────

/** Fold a creator name for matching. */
function normalise(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Stage name → profile picture, for the creators this month's sales name.
 *
 * Sales carry a creator **name** typed into the export, not a creator id, so
 * the roster is joined on the folded name. A name that matches nothing still
 * renders — `CreatorAvatar` falls back to initials on a colour hashed from that
 * same string (rule 7), so an unrecognised creator looks like a creator rather
 * than like a rendering failure. The roster itself costs nothing here:
 * `useCreators` is a module-level shared store the rest of the page is already
 * reading.
 */
function useCreatorPhotos(): Map<string, string | null> {
  const creators = useCreators();
  return useMemo(() => {
    const out = new Map<string, string | null>();
    for (const creator of creators) out.set(normalise(creator.stageName), creator.photoURL ?? null);
    return out;
  }, [creators]);
}
