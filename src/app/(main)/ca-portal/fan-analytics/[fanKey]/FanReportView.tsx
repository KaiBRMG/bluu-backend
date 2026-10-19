'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Link2, Pencil, RotateCcw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { AttrChip, KpiTile, LegendSwatch, LoadError, fanReportHref } from '@/components/buddyx/buddyxUi';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { formatSaleDateTime, formatUsd, pluralise } from '@/lib/salary/salaryFormat';
import { saleTypeLabel } from '@/lib/salary/saleTypes';
import { SALES_CUTOVER_AT } from '@/lib/salary/salaryConstants';
import { daysAgo } from '@/lib/buddyx/analyticsFormat';
import { SALE_KIND_COLORS } from '@/lib/buddyx/chartColors';
import { STATUS_COLORS, TYPE_LABELS, type CRStatus } from '@/lib/campaignTracking';
import { FAN_NAME_MAX, FAN_NAME_SOURCE_LABEL, cleanFanName } from '@/lib/fans/fanIdentity';
import { formatMonthLabelShort } from '@/lib/salary/salaryDate';
import type { FanCustomItem, FanReport } from '@/lib/buddyx/analyticsTypes';

/**
 * One fan, everything known — `/ca-portal/fan-analytics/[fanKey]`.
 *
 * Reads as the questions someone brings to a fan: who is this (and is that
 * really their name), what are they worth, what do they order and do they
 * owe us, and then the record — purchases, customs, subscriptions. The name
 * is the focal object: it is the one thing on the page the reader can change,
 * and it changes everywhere the fan appears.
 */

const SUB_TYPE: Record<string, string> = {
  new_subscriber: 'New subscriber',
  returning_subscriber: 'Returning subscriber',
  new_subscriber_trial: 'Free trial',
};
const USUAL: Record<string, string> = { tips: 'mostly tips', ppv: 'mostly PPVs', mixed: 'tips and PPVs' };
const PURCHASES_SHOWN = 25;

const spendConfig = {
  tips: { label: 'Tips', color: SALE_KIND_COLORS.tip },
  ppv: { label: 'PPV', color: SALE_KIND_COLORS.ppv },
} satisfies ChartConfig;

export function FanReportView({ fanKey }: { fanKey: string }) {
  const router = useRouter();
  const { data, loading, error, reload } = useBuddyxAnalytics<FanReport | { movedTo: string }>(`/api/fans/${encodeURIComponent(fanKey)}`);
  const movedTo = data && 'movedTo' in data ? data.movedTo : null;
  const report = data && !('movedTo' in data) && data.fanKey === fanKey ? data : null;

  // A handle-only fan that has been linked now lives under their id.
  useEffect(() => {
    if (movedTo) router.replace(fanReportHref(movedTo));
  }, [movedTo, router]);

  return (
    <div className="max-w-7xl space-y-6">
      <Link
        href="/ca-portal/fan-analytics"
        prefetch={false}
        className="inline-flex items-center gap-1 rounded-sm text-xs text-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Fan Analytics
      </Link>

      {(loading && !report) || movedTo ? (
        <FanReportSkeleton bare />
      ) : error && !report ? (
        error.toLowerCase().includes('not found') ? (
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Fan not found</h1>
            <p className="text-sm text-zinc-400">There is no fan with this id among the creators you can see.</p>
          </div>
        ) : (
          <LoadError error={error} onRetry={() => void reload(true)} />
        )
      ) : report ? (
        <ReportBody report={report} onChanged={() => void reload(true)} />
      ) : null}
    </div>
  );
}

export function FanReportSkeleton({ bare = false }: { bare?: boolean }) {
  return (
    <div className={cn('space-y-4', !bare && 'max-w-7xl')}>
      <Skeleton className="h-8 w-64 rounded-md" />
      <Skeleton className="h-4 w-96 max-w-full rounded-md" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[92px] rounded-xl" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

// ─── Body ────────────────────────────────────────────────────────────

function ReportBody({ report, onChanged }: { report: FanReport; onChanged: () => void }) {
  const { timezone } = useViewerTimezone();
  const creators = useMemo(() => {
    const ids = new Set<string>();
    for (const c of report.spend.byCreator) ids.add(c.creatorId);
    for (const c of report.customs.items) if (c.creatorId) ids.add(c.creatorId);
    return [...ids];
  }, [report]);
  const topType = report.customs.byType[0];

  return (
    <>
      <FanHeader report={report} creators={creators} onChanged={onChanged} />

      {report.handle && !report.fanId && <UnmatchedNotice report={report} onLinked={onChanged} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label="Lifetime spend"
          basis="gross"
          value={formatUsd(report.spend.lifetime)}
          meta={report.spend.lifetime > 0 ? `${formatUsd(report.spend.tips)} tips · ${formatUsd(report.spend.ppv)} PPV` : report.fanId ? 'No purchases on record' : 'Not matched to sales'}
        />
        <KpiTile
          label="Last purchase"
          value={report.spend.lastPurchaseAt ? daysAgo(report.spend.lastPurchaseAt) : '—'}
          meta={report.spend.usual ? `Buys ${USUAL[report.spend.usual]}` : undefined}
        />
        <KpiTile
          label="Customs ordered"
          value={String(report.customs.total)}
          meta={topType ? `Mostly ${typeLabel(topType.type)} · ${topType.count} of ${report.customs.total}` : 'None yet'}
        />
        <KpiTile
          label="Owed on customs"
          value={formatUsd(report.customs.outstanding.amount)}
          meta={
            report.customs.outstanding.count + report.customs.abandoned.count === 0
              ? report.customs.total > 0 ? 'Every custom is settled' : undefined
              : [
                  report.customs.outstanding.count ? `${pluralise(report.customs.outstanding.count, 'unpaid custom')}` : null,
                  report.customs.abandoned.count ? `${report.customs.abandoned.count} abandoned` : null,
                ].filter(Boolean).join(' · ')
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <SpendSection report={report} />
          <CustomsSection report={report} timezone={timezone} />
          <PurchasesSection report={report} timezone={timezone} />
        </div>
        <aside className="min-w-0 space-y-4">
          <NamesOnCustoms report={report} />
          <EarnedBy report={report} />
          <Acquisition report={report} />
          <Subscriptions report={report} timezone={timezone} />
        </aside>
      </div>
    </>
  );
}

// ─── Header: the name, where it came from, and the edit ──────────────

function FanHeader({ report, creators, onChanged }: { report: FanReport; creators: string[]; onChanged: () => void }) {
  const authFetch = useAuthFetch();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const identity = report.fanId ?? (report.handle ? `@${report.handle}` : report.fanKey);

  const startEdit = () => {
    setDraft(report.name ?? '');
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const save = async (name: string | null) => {
    setSaving(true);
    try {
      await authFetch(`/api/fans/${encodeURIComponent(report.fanKey)}/name`, { method: 'PUT', body: JSON.stringify({ name }) });
      toast.success(name === null ? 'Back to the automatic name' : `Fan renamed to ${name}`, {
        description: 'Updated on their sales and analytics too.',
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the name');
    } finally {
      setSaving(false);
    }
  };

  const trimmed = cleanFanName(draft);

  return (
    <header className="space-y-2">
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={e => {
            e.preventDefault();
            if (trimmed && trimmed !== report.name) void save(trimmed);
            else setEditing(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') setEditing(false);
          }}
        >
          <label htmlFor="fan-name" className="sr-only">Fan name</label>
          <Input
            id="fan-name"
            ref={inputRef}
            value={draft}
            maxLength={FAN_NAME_MAX}
            onChange={e => setDraft(e.target.value)}
            placeholder="What the team calls this fan"
            className="h-10 w-80 max-w-full text-lg font-semibold"
            disabled={saving}
            autoFocus
          />
          <Button type="submit" size="sm" disabled={saving || !trimmed} className="bg-[#2563eb] text-white hover:bg-[#1d4ed8]">
            {saving ? 'Saving…' : 'Save name'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </Button>
          <p className="basis-full text-[11px] text-zinc-400">
            A name set here sticks — customs and BuddyX won&apos;t change it until you revert it.
          </p>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={cn('text-2xl font-bold tracking-tight', !report.name && 'font-mono text-xl text-zinc-300')}>
            {report.name ?? identity}
          </h1>
          <Button size="sm" variant="ghost" onClick={startEdit} className="text-zinc-400 hover:text-white">
            <Pencil className="size-3.5" aria-hidden /> {report.name ? 'Rename' : 'Name this fan'}
          </Button>
        </div>
      )}

      {!editing && <NameProvenance report={report} onRevert={() => void save(null)} saving={saving} />}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-zinc-400">
        {report.fanId && <span className="font-mono text-xs text-zinc-300">{report.fanId}</span>}
        {report.handle && <span className="font-mono text-xs text-zinc-300">@{report.handle}</span>}
        {report.handles.length > 0 && <span>also @{report.handles.join(', @')}</span>}
        <a
          href={report.profileLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          OnlyFans profile <ExternalLink className="size-3" aria-hidden />
        </a>
        {report.isStacker && <AttrChip>Stacker</AttrChip>}
        {creators.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            {creators.map(id => <CreatorChip key={id} creatorId={id} size="xs" />)}
          </span>
        )}
      </div>
    </header>
  );
}

/** Where the name came from, in words — and the way back from a manual one. */
function NameProvenance({ report, onRevert, saving }: { report: FanReport; onRevert: () => void; saving: boolean }) {
  if (!report.nameSource) {
    return <p className="text-sm text-zinc-400">No name yet. Name this fan and every sale, custom and report will use it.</p>;
  }
  if (report.nameSource === 'manual') {
    const at = report.manual?.at ? new Date(report.manual.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    const auto = report.automatic.name;
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
        <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">Set manually</span>
        <span>
          by {report.manual?.by ?? 'someone'}{at ? ` · ${at}` : ''}
        </span>
        <span aria-hidden>·</span>
        <button
          type="button"
          onClick={onRevert}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-sm text-zinc-300 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <RotateCcw className="size-3" aria-hidden />
          {auto
            ? `Revert to “${auto}” (${FAN_NAME_SOURCE_LABEL[report.automatic.source!].toLowerCase()})`
            : 'Revert — no automatic name, the id will show'}
        </button>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
      <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">{FAN_NAME_SOURCE_LABEL[report.nameSource]}</span>
      <span>
        {report.nameSource === 'customs' && report.customsVote
          ? report.customsVote.votes > 1
            ? `Used on ${report.customsVote.votes} of ${pluralise(report.customsVote.total, 'custom')}.`
            : report.customsVote.total > 1
              ? 'No name repeats across their customs, so the most recent one is used.'
              : 'The name on their custom.'
          : report.nameSource === 'customs'
            ? 'The name staff use on their customs.'
            : 'The name OnlyFans showed when the fan was synced.'}{' '}
        Updates on its own until someone renames them.
      </span>
    </p>
  );
}

/** A fan known only by handle: their customs can't meet their sales until linked. */
function UnmatchedNotice({ report, onLinked }: { report: FanReport; onLinked: () => void }) {
  const authFetch = useAuthFetch();
  const router = useRouter();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const link = async () => {
    setSaving(true);
    try {
      const res = (await authFetch(`/api/fans/${encodeURIComponent(report.fanKey)}/link`, {
        method: 'POST',
        body: JSON.stringify({ fanId: value.trim() }),
      })) as { fanKey: string };
      toast.success('Fan linked to their OnlyFans id', { description: 'Their customs now sit with their sales.' });
      router.replace(fanReportHref(res.fanKey));
      onLinked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not link this fan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4" aria-labelledby="unmatched">
      <h2 id="unmatched" className="flex items-center gap-2 text-sm font-semibold text-orange-400">
        <span className="size-2 rounded-full bg-orange-400" aria-hidden /> Known by handle only
      </h2>
      <p className="mt-1 max-w-[70ch] text-sm text-zinc-300">
        Their customs used a link to <span className="font-mono text-xs">onlyfans.com/{report.handle}</span>, which has no OnlyFans id in it — so their purchases can&apos;t be matched here.
        {report.canLink
          ? ' Open their profile, copy the id (the number in a link like onlyfans.com/u123456) and link it.'
          : ' A CA admin can link them to their OnlyFans id.'}
      </p>
      {report.canLink && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={e => {
            e.preventDefault();
            if (value.trim()) void link();
          }}
        >
          <label htmlFor="link-id" className="sr-only">OnlyFans id or /u link</label>
          <Input
            id="link-id"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="598208266 or onlyfans.com/u598208266"
            className="h-8 w-72 max-w-full font-mono text-xs"
            disabled={saving}
          />
          <Button type="submit" size="sm" variant="outline" disabled={saving || !value.trim()}>
            <Link2 className="size-3.5" aria-hidden /> {saving ? 'Linking…' : 'Link OnlyFans id'}
          </Button>
        </form>
      )}
    </section>
  );
}

// ─── Spend ───────────────────────────────────────────────────────────

function SpendSection({ report }: { report: FanReport }) {
  if (!report.fanId) return null;
  const monthly = report.spend.monthly.slice(-18).map(m => ({ ...m, label: formatMonthLabelShort(m.month) }));
  return (
    <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="spend">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="spend" className="text-sm font-semibold">Spend by month <span className="font-normal text-zinc-400">· gross</span></h2>
        <span className="flex items-center gap-3 text-xs text-zinc-300">
          <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.tip} /> Tips</span>
          <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.ppv} /> PPV</span>
        </span>
      </div>
      {monthly.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No purchases on record.</p>
      ) : (
        <>
          <ChartContainer config={spendConfig} className="mt-3 h-[180px] w-full">
            <BarChart data={monthly} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={v => `$${v}`} />
              <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => [` ${formatUsd(Number(v))}`, n === 'tips' ? 'Tips' : 'PPV']} />} />
              <Bar dataKey="tips" stackId="s" fill="var(--color-tips)" />
              <Bar dataKey="ppv" stackId="s" fill="var(--color-ppv)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
          <ul className="sr-only">
            {monthly.map(m => <li key={m.month}>{m.label}: {formatUsd(m.tips)} tips, {formatUsd(m.ppv)} PPV</li>)}
          </ul>
        </>
      )}
      {report.spend.byCreator.length > 1 && (
        <ul className="mt-4 divide-y divide-white/[0.07] border-t border-white/[0.07]">
          {report.spend.byCreator.map(c => {
            const share = report.spend.lifetime > 0 ? c.lifetime / report.spend.lifetime : 0;
            return (
              <li key={c.creatorId} className="relative flex items-center gap-3 py-2 text-sm">
                <span className="absolute inset-y-1 left-0 rounded-md bg-white/[0.04]" style={{ width: `${Math.max(share * 100, 1)}%` }} aria-hidden />
                <span className="relative min-w-0 flex-1"><CreatorChip creatorId={c.creatorId} size="xs" /></span>
                <span className="relative text-[11px] text-zinc-400">last {daysAgo(c.lastPurchaseAt)}</span>
                <span className="relative w-24 text-right tabular-nums">{formatUsd(c.lifetime)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Customs ─────────────────────────────────────────────────────────

function CustomsSection({ report, timezone }: { report: FanReport; timezone: string }) {
  const { customs } = report;
  return (
    <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="customs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="customs" className="text-sm font-semibold">Customs &amp; campaigns</h2>
        {customs.total > 0 && (
          <p className="text-[11px] text-zinc-400">
            {pluralise(customs.total, 'order')}
            {customs.completed > 0 && ` · ${customs.completed} completed`}
            {customs.rejected > 0 && ` · ${customs.rejected} rejected`}
          </p>
        )}
      </div>
      {customs.total === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">This fan hasn&apos;t ordered a custom.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {customs.byType.map(t => (
              <AttrChip key={t.type}>
                {typeLabel(t.type)} <span className="ml-1 tabular-nums text-zinc-400">{t.count}</span>
              </AttrChip>
            ))}
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-4 rounded-lg bg-white/[0.04] p-3">
            <div>
              <dt className="text-xs text-zinc-400">Lifetime value</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatUsd(customs.collected)}</dd>
              <dd className="text-[11px] text-zinc-400">paid across {pluralise(customs.total, 'order')}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">Unpaid</dt>
              <dd className={cn('text-lg font-semibold tabular-nums', customs.outstanding.amount > 0 && 'text-red-400')}>
                {formatUsd(customs.outstanding.amount)}
              </dd>
              <dd className="text-[11px] text-zinc-400">
                {customs.outstanding.count ? `owed on ${pluralise(customs.outstanding.count, 'live custom')}` : 'nothing owed'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">Abandoned</dt>
              <dd className="text-lg font-semibold tabular-nums">{customs.abandoned.count}</dd>
              <dd className="text-[11px] text-zinc-400">
                {customs.abandoned.count === 0
                  ? 'none archived unpaid'
                  : [
                      customs.abandoned.amount > 0 ? `${formatUsd(customs.abandoned.amount)} never paid` : null,
                      customs.abandoned.unknownAmount > 0 ? `${customs.abandoned.unknownAmount} archived before amounts were kept` : null,
                    ].filter(Boolean).join(' · ')}
              </dd>
            </div>
          </dl>

          <ul className="mt-3 divide-y divide-white/[0.07]">
            {customs.items.map(item => <CustomRow key={item.id} item={item} fanName={report.name} timezone={timezone} />)}
          </ul>
        </>
      )}
    </section>
  );
}

function typeLabel(type: string): string {
  return (TYPE_LABELS as Record<string, string>)[type] ?? type;
}

function customStatus(item: FanCustomItem): { label: string; className: string } {
  if (item.isCampaign) {
    return item.isArchived
      ? { label: 'Archived', className: STATUS_COLORS.Archived }
      : { label: 'Open', className: STATUS_COLORS['In Progress'] };
  }
  const status = item.status as CRStatus;
  return { label: status, className: STATUS_COLORS[status] ?? STATUS_COLORS.Archived };
}

function CustomRow({ item, fanName, timezone }: { item: FanCustomItem; fanName: string | null; timezone: string }) {
  const status = customStatus(item);
  const differentName = item.fanName && fanName && item.fanName.toLowerCase() !== fanName.toLowerCase();
  return (
    <li className="flex gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', status.className)}>{status.label}</span>
          <AttrChip>{typeLabel(item.type)}</AttrChip>
          {item.CR && <span className="font-mono text-xs text-zinc-300">{item.CR}</span>}
          {item.creatorId && <CreatorChip creatorId={item.creatorId} size="xs" />}
        </div>
        {item.description && <p className="mt-1 max-w-[70ch] text-sm text-zinc-400">{item.description}</p>}
        <p className="mt-0.5 text-[11px] text-zinc-400">
          {item.createdTime ? formatSaleDateTime(item.createdTime, timezone) : '—'}
          {differentName && <> · as <span className="text-zinc-300">“{item.fanName}”</span></>}
        </p>
      </div>
      <div className="w-32 shrink-0 text-right text-sm tabular-nums">
        <div>{formatUsd(item.abandoned && item.abandonedAmount !== null ? item.collected + item.abandonedAmount : item.totalAmount)}</div>
        <div className="text-[11px]">
          {item.outstanding > 0 ? (
            <span className="text-red-400">owes {formatUsd(item.outstanding)}</span>
          ) : item.abandoned ? (
            <span className="text-orange-400">
              abandoned{item.abandonedAmount !== null ? ` · ${formatUsd(item.abandonedAmount)} unpaid` : ''}
            </span>
          ) : item.status === 'Rejected' ? (
            <span className="text-zinc-400">rejected</span>
          ) : (
            <span className="text-zinc-400">paid {formatUsd(item.collected)}</span>
          )}
        </div>
      </div>
    </li>
  );
}

// ─── Purchases ───────────────────────────────────────────────────────

function PurchasesSection({ report, timezone }: { report: FanReport; timezone: string }) {
  const [all, setAll] = useState(false);
  if (!report.fanId) return null;
  const shown = all ? report.purchases : report.purchases.slice(0, PURCHASES_SHOWN);
  // Newest first; the first one at or before the cutover gets the marker.
  const cutoverIndex = shown.findIndex(p => Date.parse(p.occurredAt) <= SALES_CUTOVER_AT);
  const multiCreator = new Set(report.purchases.map(p => p.creatorId)).size > 1;

  return (
    <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="purchases">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="purchases" className="text-sm font-semibold">Purchases <span className="font-normal text-zinc-400">· gross</span></h2>
        {report.purchases.length > 0 && <p className="text-[11px] text-zinc-400">{pluralise(report.purchases.length, 'purchase')}</p>}
      </div>
      {report.purchases.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No purchases on record.</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {shown.map((p, index) => (
              <li key={p.saleId} className="py-1.5">
                {index === cutoverIndex && index > 0 && <p className="pb-1 text-[11px] text-zinc-400">Infloww history — up to 08:50 on 4 Oct (salary time)</p>}
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-32 shrink-0 tabular-nums text-zinc-400">{formatSaleDateTime(p.occurredAt, timezone)}</span>
                  <AttrChip>{saleTypeLabel(p.type)}</AttrChip>
                  {multiCreator && p.creatorId && <CreatorChip creatorId={p.creatorId} size="xs" />}
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{p.earnedBy ?? 'Unassigned'}</span>
                  <span className="tabular-nums">{formatUsd(p.gross)}</span>
                </div>
              </li>
            ))}
          </ul>
          {report.purchases.length > PURCHASES_SHOWN && (
            <Button size="sm" variant="ghost" className="mt-2 text-zinc-400 hover:text-white" onClick={() => setAll(v => !v)}>
              {all ? 'Show fewer' : `Show all ${report.purchases.length}`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

// ─── Side rail ───────────────────────────────────────────────────────

/** Every name the fan has been given on a custom — the evidence behind a customs name. */
function NamesOnCustoms({ report }: { report: FanReport }) {
  const names = useMemo(() => {
    const tally = new Map<string, { name: string; count: number }>();
    for (const item of report.customs.items) {
      const name = item.fanName.trim();
      if (!name) continue;
      const entry = tally.get(name.toLowerCase()) ?? { name, count: 0 };
      entry.count += 1;
      tally.set(name.toLowerCase(), entry);
    }
    return [...tally.values()].sort((a, b) => b.count - a.count);
  }, [report]);
  if (names.length < 2) return null;
  return (
    <section className={cn('rounded-xl p-4', SURFACE)} aria-labelledby="names">
      <h2 id="names" className="text-xs font-semibold text-zinc-400">Called on customs</h2>
      <ul className="mt-2 space-y-1">
        {names.map(n => (
          <li key={n.name} className="flex justify-between text-sm">
            <span className="truncate">{n.name}</span>
            <span className="tabular-nums text-zinc-400">×{n.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EarnedBy({ report }: { report: FanReport }) {
  if (report.earnedBy.length === 0) return null;
  return (
    <section className={cn('rounded-xl p-4', SURFACE)} aria-labelledby="earned">
      <h2 id="earned" className="text-xs font-semibold text-zinc-400">Earned by · gross</h2>
      <ul className="mt-2 space-y-1">
        {report.earnedBy.map(e => (
          <li key={e.label} className="flex justify-between gap-3 text-sm">
            <span className="truncate">{e.label}</span>
            <span className="shrink-0 tabular-nums">{formatUsd(e.gross)} <span className="text-[11px] text-zinc-400">· {e.count}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Acquisition({ report }: { report: FanReport }) {
  if (!report.fanId) return null;
  return (
    <section className={cn('rounded-xl p-4', SURFACE)} aria-labelledby="acquired">
      <h2 id="acquired" className="text-xs font-semibold text-zinc-400">Acquired through</h2>
      {report.acquisition.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-400">No link on record.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {report.acquisition.map(a => (
            <li key={`${a.creatorId}-${a.linkId}`} className="text-sm">
              {a.kind === 'free-trial' ? 'Free-trial link' : 'Tracking link'} · {a.linkName ?? a.linkId}
              <span className="mt-0.5 block"><CreatorChip creatorId={a.creatorId} size="xs" /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Subscriptions({ report, timezone }: { report: FanReport; timezone: string }) {
  if (report.subscriptions.length === 0) return null;
  return (
    <section className={cn('rounded-xl p-4', SURFACE)} aria-labelledby="subs">
      <h2 id="subs" className="text-xs font-semibold text-zinc-400">Subscriptions</h2>
      <ul className="mt-2 divide-y divide-white/[0.07]">
        {report.subscriptions.map(s => (
          <li key={s.id} className="py-1.5 text-sm">
            <span>{SUB_TYPE[s.subType ?? ''] ?? s.subType ?? 'Subscribed'}</span>
            <span className="block text-[11px] tabular-nums text-zinc-400">
              {s.at ? formatSaleDateTime(s.at, timezone) : '—'}
              {s.priceGross > 0 && ` · ${formatUsd(s.priceGross)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
