'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PeriodPicker, dayKeyToDate } from '@/components/buddyx/PeriodPicker';
import { SyncStatus } from '@/components/buddyx/SyncStatus';
import { LegendSwatch, PPV_ATTRIBUTION, TIPS_ATTRIBUTION, KpiTile, Fact, LoadError } from '@/components/buddyx/buddyxUi';
import { FlagList } from '@/components/buddyx/integrityUi';
import { DailySalesChart, SalesBoard, TeamSalesBand, formatDayRange } from '@/components/buddyx/SalesBoard';
import { chatterPeriodOptions, chatterAnalyticsUrl, chatterReportHref } from '@/components/buddyx/chatterPeriods';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatCount, formatDuration, formatRate } from '@/lib/buddyx/analyticsFormat';
import { SALE_KIND_COLORS } from '@/lib/buddyx/chartColors';
import { TEAM_PERIODS } from '@/lib/buddyx/constants';
import { BOARD_RATE_MAX_DAYS, type ChatterAnalytics, type ChatterPeriod, type IntegrityFlag } from '@/lib/buddyx/analyticsTypes';

/**
 * Chatter Analytics — `/ca-portal/chatter-analytics`.
 *
 * **Sales first.** The page answers "who sold what?" for everyone who opens
 * it: the team's money for the period, then every agent on one named board
 * ranked by gross, then the viewer's own figures. An admin also gets each row
 * as a link to that agent's report (`./[uid]`) and, last, the integrity flags.
 *
 * Coverage (BuddyX online ÷ clocked) led this page until 2026-10-14 and was
 * retired: BuddyX online time always matched clocked time, so it said nothing.
 *
 * The board is named for agents too, but carries **sales only** — the server
 * sends `SalesBoardRow`, never a colleague's activity or integrity. Flags are
 * admin only. Display only: nothing on this page changes worked time or pay.
 */

export default function ChatterAnalyticsPage() {
  const [period, setPeriod] = useState<ChatterPeriod>('7d');
  const [from, setFrom] = useState<Date | undefined>(undefined);
  const [to, setTo] = useState<Date | undefined>(undefined);

  const range = useMemo(
    () => ({ from: from ? format(from, 'yyyy-MM-dd') : null, to: to ? format(to, 'yyyy-MM-dd') : null }),
    [from, to],
  );
  const url = useMemo(() => chatterAnalyticsUrl('/api/analytics/chatters', period, range.from, range.to), [period, range]);
  const { data, loading, error, reload } = useBuddyxAnalytics<ChatterAnalytics>(url);
  // A preset's days are resolved on the server (salary timezone); show the ones it answered with.
  const presetData = period !== 'custom' && data?.period === period ? data : null;

  return (
    <AppLayout>
      <div className="max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Chatter Analytics</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Every chat agent&apos;s sales, ranked — from the same ledger as the Sales Report. Money is gross — what fans paid;
              net is 80% after OnlyFans&apos; 20%.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PeriodPicker
              options={chatterPeriodOptions()}
              value={period}
              onPresetChange={setPeriod}
              from={period === 'custom' ? from : dayKeyToDate(presetData?.from)}
              to={period === 'custom' ? to : dayKeyToDate(presetData?.to)}
              onRangeChange={(nextFrom, nextTo) => {
                setPeriod('custom');
                setFrom(nextFrom);
                setTo(nextTo);
              }}
            />
            <SyncStatus scope="chatters" onSynced={() => void reload(true)} />
          </div>
        </div>

        {!url ? (
          <p className="text-sm text-zinc-400">{from && to ? 'The end date must be on or after the start date.' : 'Pick a start and an end date.'}</p>
        ) : loading && !data ? (
          <PageSkeleton />
        ) : error && !data ? (
          <LoadError error={error} onRetry={() => void reload(true)} />
        ) : data ? (
          <ChatterBody data={data} range={range} onPulled={() => void reload(true)} />
        ) : null}
      </div>
    </AppLayout>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-[236px] rounded-xl" />
      <div className={cn('space-y-px rounded-xl p-1.5', SURFACE)}>
        {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
      </div>
    </div>
  );
}

function ChatterBody({
  data,
  range,
  onPulled,
}: {
  data: ChatterAnalytics;
  range: { from: string | null; to: string | null };
  onPulled: () => void;
}) {
  const { user } = useAuth();
  const viewerUid = user?.uid ?? null;
  const me = data.me;
  const isAdmin = data.isAdmin;
  const flags = useMemo(() => data.flags ?? [], [data.flags]);
  const flagsByUid = useMemo(() => {
    const map = new Map<string, IntegrityFlag[]>();
    for (const f of flags) map.set(f.uid, [...(map.get(f.uid) ?? []), f]);
    return map;
  }, [flags]);
  const hrefFor = (uid: string) => chatterReportHref(uid, data.period, range.from, range.to);
  const placed = data.board.filter(r => r.uid);
  const myPlace = placed.findIndex(r => r.uid === viewerUid);
  const myRow = myPlace >= 0 ? placed[myPlace] : null;
  const ratesShown = data.board.some(r => r.clockedMs !== null);
  const covered = data.to >= data.activityFrom;

  return (
    <div className="space-y-8">
      <TeamSalesBand team={data.team} />

      {/* ── The board ── */}
      <section aria-labelledby="board-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="board-heading" className="text-sm font-semibold">Every agent, by sales</h2>
          <p className="text-[11px] text-zinc-400">
            {isAdmin ? 'Open an agent for their sales by account and by shift. ' : ''}
            {data.team.prev ? `Change is against ${formatDayRange(data.team.prev.from, data.team.prev.to)}. ` : ''}
            {!ratesShown && `Per-hour figures cover ranges up to ${Math.floor(BOARD_RATE_MAX_DAYS / 30)} months.`}
          </p>
        </div>
        <SalesBoard
          rows={data.board}
          viewerUid={viewerUid}
          flagsByUid={isAdmin ? flagsByUid : undefined}
          hrefFor={isAdmin ? hrefFor : undefined}
          ratesShown={ratesShown}
        />
      </section>

      {/* ── The viewer's own figures ── */}
      {(me || !isAdmin) && (
        <section aria-labelledby="mine-heading" className="space-y-4">
          <div>
            <h2 id="mine-heading" className="text-sm font-semibold">Your figures</h2>
            {isAdmin && <p className="mt-0.5 text-[11px] text-zinc-400">You chat too, so here is your own row as an agent sees it.</p>}
          </div>

          {me ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <KpiTile
                label="Your place"
                value={myRow ? `#${myPlace + 1}` : '—'}
                meta={myRow ? `of ${placed.length}${myRow.grossPerHour !== null ? ` · ${formatUsd(myRow.grossPerHour)} per clocked hour` : ''}` : undefined}
              />
              <KpiTile label="PPV revenue" basis="gross" tip={PPV_ATTRIBUTION} value={formatUsd(me.ppvGross)} meta={`${formatCount(me.ppvSales)} sold`} />
              <KpiTile label="Tips" basis="gross" tip={TIPS_ATTRIBUTION} value={formatUsd(me.tipsGross)} meta={`${formatCount(me.tipsCount)} tips`} />
              <KpiTile label="Unlock rate" value={formatRate(me.unlockRate, 1)} meta={`${formatCount(me.ppvsSent)} PPVs sent`} />
              <KpiTile
                label="Median reply time"
                value={formatDuration(me.medianResponseTimeMs)}
                meta={me.p75ResponseTimeMs !== null ? `3 in 4 within ${formatDuration(me.p75ResponseTimeMs)}` : undefined}
              />
            </div>
          ) : (
            <p className="text-sm text-zinc-400">
              No sales or BuddyX activity for you in this period. If you worked in BuddyX, ask an admin to check your account is linked.
            </p>
          )}

          {data.from < data.activityFrom && (
            <p className="text-sm text-zinc-400">
              Sales cover the whole period — Infloww history before 4 Oct 2026, BuddyX after. Messages, unlock rate and reply times only
              exist from BuddyX, which starts {formatDayLabelWithWeekday(data.activityFrom)};{' '}
              {data.to < data.activityFrom ? 'this period has none' : 'they cover only the days from then'}.
            </p>
          )}

          {!data.hasMedians && covered && <CustomMedianNote data={data} isAdmin={isAdmin} onPulled={onPulled} />}

          {me && data.daily.length > 0 && (
            <div className={cn('rounded-xl p-5', SURFACE)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">Your sales by day</h3>
                <div className="flex items-center gap-3 text-xs text-zinc-300">
                  <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.ppv} /> PPV</span>
                  <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.tip} /> Tips</span>
                </div>
              </div>
              <DailySalesChart daily={data.daily} className="mt-3" />
            </div>
          )}

          {me && (
            <div className={cn('rounded-xl p-5', SURFACE)}>
              <h3 className="text-sm font-semibold">Messaging</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                <Fact label="Fans chatted" value={formatCount(me.fansChatted)} />
                <Fact label="Messages" value={formatCount(me.totalMessages)} />
                <Fact label="PPVs sent → unlocked" value={`${formatCount(me.ppvsSent)} → ${formatCount(me.ppvsUnlocked)}`} meta={formatRate(me.unlockRate, 1)} />
                <Fact
                  label="Mass messages"
                  value={formatCount(data.mass.count)}
                  meta={`${data.mass.avgPrice !== null ? `avg list price ${formatUsd(data.mass.avgPrice)}` : 'all free'} · ${data.mass.unsent} unsent`}
                />
              </dl>
            </div>
          )}
        </section>
      )}

      {/* ── Integrity, admin only, last ── */}
      {isAdmin && (
        <section aria-labelledby="flags-heading" className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="flags-heading" className="text-sm font-semibold">What needs a look</h2>
            <p className="text-[11px] text-zinc-400">Leads, not verdicts — each opens the report with the minutes behind it.</p>
          </div>
          <FlagList
            flags={flags}
            withNames
            hrefFor={f => hrefFor(f.uid)}
            cleanLine={
              covered
                ? `${placed.length} ${placed.length === 1 ? 'agent' : 'agents'}, no flags this period.`
                : 'BuddyX activity starts after this period, so there is nothing to check.'
            }
          />
        </section>
      )}
    </div>
  );
}

function CustomMedianNote({ data, isAdmin, onPulled }: { data: ChatterAnalytics; isAdmin: boolean; onPulled: () => void }) {
  const authFetch = useAuthFetch();
  const [busy, setBusy] = useState(false);
  if ((TEAM_PERIODS as readonly string[]).includes(data.period)) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
      Medians need a fresh pull for this range — reply times show “—” until then.
      {isAdmin && (
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await authFetch('/api/analytics/chatters/pull', { method: 'POST', body: JSON.stringify({ from: data.from, to: data.to }) });
              toast.success('Pulled the whole range from BuddyX');
              onPulled();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Pull failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2Icon className="activity-spinner size-3 animate-spin" aria-hidden />}
          Pull
        </Button>
      )}
    </p>
  );
}
