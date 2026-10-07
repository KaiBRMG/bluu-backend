'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, Loader2Icon, RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useUserData } from '@/hooks/useUserData';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import { useBuddyxSync } from '@/hooks/useBuddyxSync';
import { MonthPicker } from '@/components/salary/MonthPicker';
import { SyncStatus } from '@/components/buddyx/SyncStatus';
import { CreatorCombobox } from '@/components/buddyx/CreatorCombobox';
import { AttrChip, FanLabel, InfoTip, PPV_ATTRIBUTION, TIPS_ATTRIBUTION } from '@/components/buddyx/buddyxUi';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { PersonTag } from '@/components/disputes/disputeUi';
import { getCache, setCache } from '@/lib/queryCache';
import { formatRelative, formatSaleDateTime, formatUsd, pluralise, signedMoneyClass } from '@/lib/salary/salaryFormat';
import { saleTypeLabel } from '@/lib/salary/saleTypes';
import type { SalarySale } from '@/lib/salary/salaryTypes';

const HistoricalImport = dynamic(() => import('./HistoricalImport'), {
  loading: () => <Skeleton className="h-40 w-full rounded-xl" />,
});

/**
 * CA Admin → Sales — the sales ledger for the whole roster.
 *
 * A CA manager keeps the ledger trustworthy and answers "where did this
 * agent's money come from". So: the **attention band** first (what the sync
 * could not place, or placed against a rule), then **every agent's rows** for
 * the month, then the machinery in collapsed sections — the identity mapping,
 * the sync history, and the one-off historical import.
 *
 * Replaced the "Sales data" `.xlsx` upload tab; sales now arrive from BuddyX.
 */

const CACHE_TTL_MS = 60_000;
const INITIAL_ROWS = 150;
const SEGMENT = 'data-[state=on]:bg-[#2563eb]! data-[state=on]:text-white! text-xs';

interface AllSalesResponse {
  sales: SalarySale[];
  names: Record<string, string>;
  totals: { gross: number; count: number; reversals: number };
  byKind: { tip: { gross: number; count: number }; ppv: { gross: number; count: number } };
  unassigned: { tips: number; tipsGross: number; unmapped: number; claimed: number };
  flags: { attributionConflicts: string[]; vanishedAfterFinalise: string[]; removed: number };
  spansCutover: boolean;
}

interface MappingResponse {
  chatters: Array<{
    chatterId: string;
    name: string | null;
    email: string | null;
    status: string | null;
    uid: string | null;
    displayName: string | null;
    match: 'email' | 'manual' | 'none';
  }>;
  models: Array<{
    modelId: string;
    handle: string | null;
    customName: string | null;
    creatorId: string | null;
    creatorName: string | null;
    match: 'handle' | 'manual' | 'none';
  }>;
}

interface SyncRun {
  runId: string;
  triggerName: string;
  scopes: string[];
  startedAt: string | null;
  durationMs: number;
  requestCount: number;
  counts: Record<string, number>;
  errors: string[];
  dryRun: boolean;
  partial: boolean;
}

interface PreviewRow {
  uid: string | null;
  name: string;
  day: string;
  tips: number;
  ppv: number;
  count: number;
}

type KindFilter = 'all' | 'tip' | 'ppv';

export default function AdminSales({
  month,
  onMonthChange,
  timezone,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  timezone: string;
}) {
  const { user } = useAuth();
  const { userData } = useUserData();
  const isAdmin = userData?.groups?.includes('admin') === true || userData?.role === 'admin';

  const [data, setData] = useState<AllSalesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<MappingResponse | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  // Fetched once here; the Sync history section renders the same list.
  const [runs, setRuns] = useState<SyncRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const lastRun = useMemo(() => runs?.find(r => r.scopes.includes('sales') && !r.dryRun) ?? null, [runs]);

  // ── Filters ──
  const [agent, setAgent] = useState('all');
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const authed = useAuthFetch();

  const load = useCallback(
    async (force = false) => {
      if (!user) return;
      const key = `bluu_admin_sales_v1:${user.uid}:${month}`;
      if (!force) {
        const cached = getCache<AllSalesResponse>(key, CACHE_TTL_MS);
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }
        setData(null);
        setLoading(true);
      }
      setError(null);
      try {
        const body = (await authed(`/api/ca-salary/sales?month=${month}&userId=all`)) as AllSalesResponse;
        setCache(key, body);
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load sales');
      } finally {
        setLoading(false);
      }
    },
    [user, month, authed],
  );

  const loadMapping = useCallback(async () => {
    try {
      setMapping((await authed('/api/admin/buddyx/mapping')) as MappingResponse);
    } catch {
      /* the band falls back to what the ledger alone can say */
    }
  }, [authed]);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(((await authed('/api/admin/buddyx/runs')) as { runs: SyncRun[] }).runs);
      setRunsError(null);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : 'Could not load the history');
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadMapping();
    void loadRuns();
  }, [loadMapping, loadRuns]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = deferredQuery.trim().toLowerCase();
    return data.sales.filter(s => {
      if (!showRemoved && s.removedAt) return false;
      if (showRemoved && !s.removedAt) return false;
      if (agent !== 'all' && s.userId !== agent) return false;
      if (creatorId && s.creatorId !== creatorId) return false;
      if (kind !== 'all' && s.kind !== kind) return false;
      if (onlyUnassigned && s.userId) return false;
      if (!needle) return true;
      return s.fanName.toLowerCase().includes(needle) || s.fanId.includes(needle) || s.employeeName.toLowerCase().includes(needle);
    });
  }, [data, deferredQuery, agent, creatorId, kind, onlyUnassigned, showRemoved]);

  const agents = useMemo(() => {
    if (!data) return [];
    const ids = [...new Set(data.sales.map(s => s.userId).filter((v): v is string => Boolean(v)))];
    return ids.map(uid => ({ uid, name: data.names[uid] ?? uid })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const filtersActive = agent !== 'all' || creatorId !== null || kind !== 'all' || onlyUnassigned || query.trim() !== '';
  const clearFilters = () => {
    setAgent('all');
    setCreatorId(null);
    setKind('all');
    setOnlyUnassigned(false);
    setQuery('');
  };
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  // ── Attention band ──
  const attention = useMemo(() => {
    if (!data) return [];
    const lines: Array<{ key: string; text: string; action?: { label: string; run: () => void } }> = [];
    const live = data.sales.filter(s => !s.removedAt);

    const unmappedChatters = mapping?.chatters.filter(c => !c.uid) ?? [];
    const unmappedRows = new Map<string, { count: number; gross: number }>();
    for (const s of live) {
      if (!s.unmappedChatterId) continue;
      const e = unmappedRows.get(s.unmappedChatterId) ?? { count: 0, gross: 0 };
      e.count += 1;
      e.gross += s.signedGross;
      unmappedRows.set(s.unmappedChatterId, e);
    }
    for (const c of unmappedChatters) {
      const rows = unmappedRows.get(c.chatterId);
      if (!rows && c.status !== 'active') continue;
      lines.push({
        key: `chatter-${c.chatterId}`,
        text: `BuddyX chatter ${c.name ?? c.chatterId}${c.email ? ` (${c.email})` : ''} matches no Bluu user${rows ? ` — ${pluralise(rows.count, 'sale')}, ${formatUsd(rows.gross)}` : ''}`,
        action: { label: 'Open mapping', run: () => setMappingOpen(true) },
      });
    }
    const unmappedModels = mapping?.models.filter(m => !m.creatorId) ?? [];
    for (const m of unmappedModels) {
      const rows = live.filter(s => !s.creatorId && s.creatorName === (m.handle ?? ''));
      lines.push({
        key: `model-${m.modelId}`,
        text: `BuddyX creator @${m.handle ?? m.modelId} matches no creator${rows.length ? ` — ${pluralise(rows.length, 'sale')}` : ''}`,
        action: { label: 'Open mapping', run: () => setMappingOpen(true) },
      });
    }
    if (data.unassigned.tips > 0) {
      lines.push({
        key: 'unassigned',
        text: `${pluralise(data.unassigned.tips, 'unassigned tip')}, ${formatUsd(data.unassigned.tipsGross)}${data.unassigned.claimed ? ` · ${data.unassigned.claimed} claimed, awaiting you` : ''}`,
        action: { label: 'Show them', run: () => { clearFilters(); setOnlyUnassigned(true); setKind('tip'); } },
      });
    }
    if (data.flags.attributionConflicts.length > 0) {
      lines.push({
        key: 'conflicts',
        text: `${pluralise(data.flags.attributionConflicts.length, 'transferred sale')} BuddyX has since credited to someone else — the transfer stands`,
      });
    }
    if (data.flags.vanishedAfterFinalise.length > 0) {
      lines.push({
        key: 'vanished',
        text: `${pluralise(data.flags.vanishedAfterFinalise.length, 'sale')} vanished from BuddyX inside a finalised month and still count`,
      });
    }
    const refused = lastRun?.counts['sales.rejectedFinalized'] ?? 0;
    if (refused > 0) {
      lines.push({ key: 'refused', text: `The last sync refused ${pluralise(refused, 'change')} to a finalised month` });
    }
    return lines;
  }, [data, mapping, lastRun]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 rounded-md" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-[420px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sales</h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            Every agent&apos;s sales for the month, synced from BuddyX. Amounts are gross — net is 80%; OnlyFans keeps 20%.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SyncStatus scope="sales" onSynced={() => { void load(true); void loadRuns(); }} />
          <MonthPicker month={month} onChange={onMonthChange} />
        </div>
      </div>

      {isAdmin && <SalesWriteSwitch authed={authed} />}

      {error && !data && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-400">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void load(true)}>
            <RotateCcw className="size-3.5" aria-hidden /> Try again
          </Button>
        </div>
      )}

      {data && (
        <>
          {/* ── Attention band (DESIGN.md §5: attention tint, static dot, names its rows) ── */}
          <section
            aria-label="Needs a look"
            className={cn(
              'rounded-xl border px-4 py-3',
              attention.length ? 'border-orange-500/20 bg-orange-500/[0.06]' : 'border-white/[0.07] bg-white/[0.025]',
            )}
          >
            {attention.length === 0 ? (
              <p className="text-sm text-zinc-400">Nothing needs a look.</p>
            ) : (
              <ul className="space-y-1.5">
                {attention.map(line => (
                  <li key={line.key} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-block size-1.5 shrink-0 rounded-full bg-orange-400" aria-hidden />
                    <span>{line.text}</span>
                    {line.action && (
                      <Button size="xs" variant="ghost" className="h-6 text-zinc-300" onClick={line.action.run}>
                        {line.action.label}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Ledger ── */}
          <section className="space-y-3" aria-label="All sales">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:max-w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden />
                <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search fan, ID or chatter" className="h-8 pl-8" aria-label="Search sales" />
              </div>
              <Select value={agent} onValueChange={setAgent}>
                <SelectTrigger size="sm" className="w-44"><SelectValue placeholder="Agent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {agents.map(a => <SelectItem key={a.uid} value={a.uid}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <CreatorCombobox value={creatorId} onChange={setCreatorId} allLabel="All creators" />
              <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={v => v && setKind(v as KindFilter)} aria-label="Kind">
                <ToggleGroupItem value="all" className={SEGMENT}>All</ToggleGroupItem>
                <ToggleGroupItem value="tip" className={SEGMENT}>Tips</ToggleGroupItem>
                <ToggleGroupItem value="ppv" className={SEGMENT}>PPV</ToggleGroupItem>
              </ToggleGroup>
              <InfoTip text={TIPS_ATTRIBUTION} />
              <InfoTip text={PPV_ATTRIBUTION} />
              <label className="ml-1 flex items-center gap-1.5 text-xs text-zinc-300">
                <Switch checked={onlyUnassigned} onCheckedChange={setOnlyUnassigned} aria-label="Unassigned only" />
                Unassigned
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                <Switch checked={showRemoved} onCheckedChange={setShowRemoved} aria-label="Removed rows only" />
                Removed
              </label>
            </div>

            <p className="text-sm text-zinc-400">
              {pluralise(filtered.length, 'sale')} ·{' '}
              <span className="tabular-nums text-foreground">{formatUsd(filtered.reduce((s, r) => s + (r.removedAt ? 0 : r.signedGross), 0))}</span> gross
              {filtersActive && (
                <>
                  {' '}·{' '}
                  <button type="button" onClick={clearFilters} className="rounded-sm text-foreground underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    Clear filters
                  </button>
                </>
              )}
            </p>

            {filtered.length === 0 ? (
              <p className="text-sm text-zinc-400">
                {filtersActive ? 'Nothing matches these filters.' : showRemoved ? 'No removed rows this month.' : 'No sales this month yet.'}
              </p>
            ) : (
              <div
                tabIndex={0}
                role="region"
                aria-label="All agents' sales, scrollable"
                className="overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.07]">
                      {['When', 'Agent', 'Creator', 'Type', 'Fan', 'Gross'].map((label, i) => (
                        <th key={label} scope="col" className={cn('whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400', i === 5 ? 'text-right' : 'text-left')}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.045]">
                    {visible.map(sale => (
                      <tr key={sale.saleId}>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-400">{formatSaleDateTime(sale.occurredAt, timezone)}</td>
                        <td className="max-w-[12rem] px-3 py-2">
                          {sale.userId ? (
                            <PersonTag name={data.names[sale.userId] ?? ''} photoURL={null} size="sm" />
                          ) : sale.unmappedChatterId ? (
                            <span className="text-xs text-orange-400">{sale.employeeName || `Chatter ${sale.unmappedChatterId}`} (not linked)</span>
                          ) : (
                            <span className="text-xs text-zinc-400">Unassigned</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {sale.creatorId ? <CreatorChip creatorId={sale.creatorId} name={sale.creatorName || undefined} size="xs" /> : sale.creatorName || '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <AttrChip>{saleTypeLabel(sale.type)}</AttrChip>
                            {data.spansCutover && <AttrChip>{sale.source === 'buddyx' ? 'BuddyX' : 'Infloww'}</AttrChip>}
                            {sale.transfer && (
                              <span className="text-[11px] text-zinc-300">
                                Transferred{sale.transfer.fromUserId ? ` from ${data.names[sale.transfer.fromUserId] ?? 'another agent'}` : ''}
                              </span>
                            )}
                            {sale.disputeId && <span className="text-[11px] text-zinc-300">Disputed</span>}
                            {sale.attributionConflict && <span className="text-[11px] text-orange-400">BuddyX disagrees</span>}
                            {sale.removedAt && (
                              <span className="text-[11px] text-zinc-400">
                                Removed {formatSaleDateTime(sale.removedAt, timezone)} — no longer in BuddyX
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="max-w-[12rem] px-3 py-2"><FanLabel name={sale.fanName} fanId={sale.fanId} className="block" /></td>
                        <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', sale.removedAt ? 'text-zinc-400 line-through' : signedMoneyClass(sale.signedGross))}>
                          {formatUsd(sale.signedGross)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filtered.length > visible.length && (
              <button type="button" onClick={() => setShowAll(true)} className="rounded-sm text-sm text-foreground underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                Show the remaining {pluralise(filtered.length - visible.length, 'sale')}
              </button>
            )}
          </section>
        </>
      )}

      {/* ── Machinery, collapsed ── */}
      <Section title="Mapping" open={mappingOpen} onOpenChange={setMappingOpen}>
        <MappingSection mapping={mapping} isAdmin={isAdmin} authed={authed} onChanged={loadMapping} />
      </Section>
      <Section title="Sync history">
        <SyncHistory runs={runs} error={runsError} />
      </Section>
      {isAdmin && (
        <Section title="Historical import">
          <p className="mb-3 max-w-[70ch] text-sm text-zinc-400">
            One-off: bring in the Infloww history BuddyX does not have. Removed once the history is imported and checked.
          </p>
          <HistoricalImport />
        </Section>
      )}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────

function Section({
  title,
  children,
  open,
  onOpenChange,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={cn('rounded-xl', SURFACE)}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
        {title}
        <ChevronDown className="size-4 text-zinc-400 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-white/[0.07] px-4 py-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

type Authed = ReturnType<typeof useAuthFetch>;

/**
 * Whether BuddyX sales are written to `ca-sales`. Off until an admin has checked
 * a dry run against the BuddyX dashboard (sequencing step 3). Admin claim.
 */
function SalesWriteSwitch({ authed }: { authed: Authed }) {
  const { salesWriteEnabled, reloadStatus } = useBuddyxSync('sales');
  const [busy, setBusy] = useState<'preview' | 'toggle' | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);

  const runPreview = async () => {
    setBusy('preview');
    try {
      const body = await authed('/api/buddyx/sync', { method: 'POST', body: JSON.stringify({ scope: 'sales', preview: true }) });
      setPreview(body.preview?.preview ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (next: boolean) => {
    setBusy('toggle');
    try {
      await authed('/api/admin/buddyx/config', { method: 'PATCH', body: JSON.stringify({ salesWriteEnabled: next }) });
      await reloadStatus();
      toast.success(next ? 'BuddyX sales sync is on — the next run writes sales' : 'BuddyX sales sync paused');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the switch');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className={cn(
        'space-y-3 rounded-xl border px-4 py-3',
        salesWriteEnabled ? 'border-white/[0.07] bg-white/[0.025]' : 'border-orange-500/20 bg-orange-500/[0.06]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {salesWriteEnabled
            ? 'BuddyX sales are being written to the ledger on every sync.'
            : 'BuddyX sales are not being written yet. Preview the window, check it against the BuddyX dashboard, then switch it on.'}
        </p>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => void runPreview()} disabled={busy !== null}>
            {busy === 'preview' && <Loader2Icon className="activity-spinner size-3.5 animate-spin" aria-hidden />}
            Preview
          </Button>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <Switch checked={salesWriteEnabled} onCheckedChange={v => void toggle(v)} disabled={busy !== null} aria-label="Write BuddyX sales" />
            Write sales
          </label>
        </div>
      </div>
      {preview && (
        preview.length === 0 ? (
          <p className="text-sm text-zinc-400">BuddyX returned no sales after the cutover in the open window.</p>
        ) : (
          <div tabIndex={0} role="region" aria-label="Sync preview, scrollable" className="max-h-72 overflow-y-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-[11px] uppercase tracking-wide text-zinc-400">
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Day</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Agent</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Tips (gross)</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">PPV (gross)</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.045]">
                {preview.map(row => (
                  <tr key={`${row.day}-${row.uid ?? row.name}`}>
                    <td className="px-3 py-1.5 tabular-nums text-zinc-400">{row.day}</td>
                    <td className={cn('px-3 py-1.5', !row.uid && 'text-orange-400')}>{row.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatUsd(row.tips)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatUsd(row.ppv)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}

function MappingSection({
  mapping,
  isAdmin,
  authed,
  onChanged,
}: {
  mapping: MappingResponse | null;
  isAdmin: boolean;
  authed: Authed;
  onChanged: () => Promise<void>;
}) {
  const { users } = useBasicUsers(isAdmin);
  const [busy, setBusy] = useState<string | null>(null);

  const link = async (kind: 'chatter' | 'model', id: string, target: string | null) => {
    setBusy(id);
    try {
      await authed('/api/admin/buddyx/mapping', { method: 'PATCH', body: JSON.stringify({ kind, id, target }) });
      await onChanged();
      toast.success(target ? 'Linked — open-month sales re-stamp on the next sync' : 'Manual link cleared — the automatic match applies on the next sync');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the link');
    } finally {
      setBusy(null);
    }
  };

  if (!mapping) return <Skeleton className="h-32 w-full rounded-lg" />;

  const matchLabel: Record<string, string> = { email: 'email', handle: 'handle', manual: 'manual', none: 'unmatched' };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Chatters</h3>
        {mapping.chatters.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No BuddyX team members synced yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {mapping.chatters.map(c => (
              <li key={c.chatterId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {c.name ?? `Chatter ${c.chatterId}`}
                  <span className="block truncate text-[11px] text-zinc-400">
                    {c.email ?? 'no email'} · <span className="font-mono">{c.chatterId}</span>
                    {c.status && c.status !== 'active' && ` · ${c.status}`}
                  </span>
                </span>
                <span className="w-44">
                  {c.uid ? <PersonTag name={c.displayName ?? ''} photoURL={null} size="sm" /> : <span className="text-xs text-orange-400">No Bluu user</span>}
                </span>
                <AttrChip>{matchLabel[c.match]}</AttrChip>
                {isAdmin && (
                  <Select
                    value={c.match === 'manual' ? c.uid ?? '__none__' : '__none__'}
                    onValueChange={v => void link('chatter', c.chatterId, v === '__none__' ? null : v)}
                    disabled={busy === c.chatterId}
                  >
                    <SelectTrigger size="sm" className="w-44" aria-label={`Link ${c.name ?? c.chatterId} manually`}>
                      <SelectValue placeholder="Link manually" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Automatic (by email)</SelectItem>
                      {users
                        // Rule 6: archived users stay out of pickers.
                        .filter(u => u.groups?.includes('CA') && !u.isArchived)
                        .sort((a, b) => a.displayName.localeCompare(b.displayName))
                        .map(u => <SelectItem key={u.uid} value={u.uid}>{u.displayName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Creators</h3>
        {mapping.models.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No BuddyX creators synced yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {mapping.models.map(m => (
              <li key={m.modelId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  @{m.handle ?? '—'}
                  <span className="block truncate text-[11px] text-zinc-400">
                    {m.customName ? `${m.customName} · ` : ''}<span className="font-mono">{m.modelId}</span>
                  </span>
                </span>
                <span className="w-44">
                  {m.creatorId ? <CreatorChip creatorId={m.creatorId} size="xs" /> : <span className="text-xs text-orange-400">No creator</span>}
                </span>
                <AttrChip>{matchLabel[m.match]}</AttrChip>
                {isAdmin && (
                  <CreatorCombobox
                    value={m.match === 'manual' ? m.creatorId : null}
                    onChange={id => void link('model', m.modelId, id)}
                    allLabel="Automatic (by handle)"
                    ariaLabel={`Link @${m.handle ?? m.modelId} manually`}
                    className="w-44"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!isAdmin && <p className="text-[11px] text-zinc-400">Linking manually needs an administrator account.</p>}
    </div>
  );
}

function SyncHistory({ runs, error }: { runs: SyncRun[] | null; error: string | null }) {

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!runs) return <Skeleton className="h-32 w-full rounded-lg" />;
  if (runs.length === 0) return <p className="text-sm text-zinc-400">No sync has run yet.</p>;

  return (
    <ul className="divide-y divide-white/[0.07]">
      {runs.map(run => {
        const written = (run.counts['sales.new'] ?? 0) + (run.counts['sales.changed'] ?? 0) + (run.counts['sales.restored'] ?? 0);
        return (
          <li key={run.runId} className="py-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                {run.triggerName} · {run.scopes.join(', ')}
                {run.dryRun && <span className="ml-1.5 text-xs text-zinc-400">(preview)</span>}
                {run.partial && <span className="ml-1.5 text-xs text-zinc-400">(stopped on time budget)</span>}
              </span>
              <span className="text-xs tabular-nums text-zinc-400">
                {formatRelative(run.startedAt)} · {(run.durationMs / 1000).toFixed(1)}s · {run.requestCount} requests
              </span>
            </div>
            <p className="mt-0.5 text-[11px] tabular-nums text-zinc-400">
              {run.counts['sales.fetched'] !== undefined
                ? `${run.counts['sales.fetched']} sales read · ${written} written · ${run.counts['sales.removed'] ?? 0} removed · ${run.counts['sales.unassigned'] ?? 0} unassigned`
                : 'No sales pass'}
            </p>
            {run.errors.map(e => <p key={e} className="mt-0.5 text-[11px] text-red-400">{e}</p>)}
          </li>
        );
      })}
    </ul>
  );
}
