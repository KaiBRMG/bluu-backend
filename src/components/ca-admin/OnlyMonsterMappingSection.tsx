'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreatorCombobox } from '@/components/buddyx/CreatorCombobox';
import { AttrChip } from '@/components/buddyx/buddyxUi';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { PersonTag } from '@/components/disputes/disputeUi';
import { DataFreshness, type FreshnessStatus } from '@/components/onlymonster/DataFreshness';
import { activeChatAgents, useBasicUsers } from '@/hooks/useBasicUsers';
import { Button } from '@/components/ui/button';
import { formatUsd } from '@/lib/salary/salaryFormat';
import type { useAuthFetch } from '@/hooks/useAuthFetch';

/**
 * CA Admin → Sales → OnlyMonster: who each OnlyMonster account and member is
 * in Bluu. Phase 1 of the BuddyX → OnlyMonster migration (documentation/onlymonster.md).
 *
 * - OnlyFans accounts match by handle against Bluu accounts on OnlyFans only;
 *   an admin can link manually (admin claim), and only to an OnlyFans account.
 * - **Accounts not in Bluu are ignored for now** (decision 2026-11-11): listed
 *   quietly in their own group, never as a problem.
 * - Fansly accounts are listed and never synced.
 * - Members match by email. Members feed activity analytics only; pay is the
 *   shift schedule, and this screen says so.
 */

interface MappingAccount {
  accountId: string;
  platform: string;
  username: string | null;
  customLabel: string | null;
  creatorId: string | null;
  creatorName: string | null;
  match: 'handle' | 'manual' | 'none';
  listed: boolean;
}

interface MappingMember {
  memberId: string;
  name: string | null;
  email: string | null;
  uid: string | null;
  displayName: string | null;
  match: 'email' | 'manual' | 'none';
  listed: boolean;
}

interface Reconciliation {
  creatorId: string;
  month: string;
  om: { gross: number; net: number };
  ledger: { gross: number; net: number };
  diff: { gross: number; net: number };
  checkedAt: string | null;
}

interface MappingResponse {
  status: FreshnessStatus;
  config: { analyticsSource: 'buddyx' | 'onlymonster'; salesWriteEnabled: boolean };
  /** Null for a `ca-admin` without the admin claim (it carries creator revenue). */
  migration: { backfill: { next: number; total: number; done: boolean } | null; reconciliation: Reconciliation[] } | null;
  linkTargets: string[];
  accounts: MappingAccount[];
  members: MappingMember[];
  runs: Array<{ runId: string; startedAt: string | null; errors: string[]; warnings: string[]; requestCount: number }>;
}

const MATCH_LABEL: Record<string, string> = { email: 'email', handle: 'handle', manual: 'manual', none: 'unmatched' };

export function OnlyMonsterMappingSection({
  isAdmin,
  authed,
  timezone,
}: {
  isAdmin: boolean;
  authed: ReturnType<typeof useAuthFetch>;
  timezone: string;
}) {
  const [data, setData] = useState<MappingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { users } = useBasicUsers(isAdmin);

  const fetchMapping = useCallback(() => authed('/api/admin/onlymonster/mapping') as Promise<MappingResponse>, [authed]);
  const onLoadError = (err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the OnlyMonster mapping');

  // State is set only in the promise callbacks, and a response that lands after
  // the section closes (unmount) is dropped.
  useEffect(() => {
    let live = true;
    fetchMapping()
      .then(body => live && (setData(body), setError(null)))
      .catch(err => live && onLoadError(err));
    return () => {
      live = false;
    };
  }, [fetchMapping]);

  const load = async () => {
    try {
      setData(await fetchMapping());
      setError(null);
    } catch (err) {
      onLoadError(err);
    }
  };

  const link = async (kind: 'account' | 'member', id: string, target: string | null) => {
    setBusy(id);
    try {
      await authed('/api/admin/onlymonster/mapping', { method: 'PATCH', body: JSON.stringify({ kind, id, target }) });
      await load();
      toast.success(target ? 'Linked' : 'Manual link cleared — the automatic match applies');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the link');
    } finally {
      setBusy(null);
    }
  };

  const setSource = async (analyticsSource: 'buddyx' | 'onlymonster') => {
    setBusy('config');
    try {
      await authed('/api/admin/onlymonster/config', { method: 'PATCH', body: JSON.stringify({ analyticsSource }) });
      await load();
      toast.success(analyticsSource === 'onlymonster' ? 'OnlyFans Analytics now reads OnlyMonster' : 'OnlyFans Analytics back on BuddyX');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the source');
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <p className="text-red-400">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!data) return <Skeleton className="h-32 w-full rounded-lg" />;

  const onlyfans = data.accounts.filter(a => a.platform === 'onlyfans' && a.listed);
  const inBluu = onlyfans.filter(a => a.creatorId);
  const notInBluu = onlyfans.filter(a => !a.creatorId);
  const otherPlatforms = data.accounts.filter(a => a.platform !== 'onlyfans' && a.listed);
  const lastRun = data.runs[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataFreshness status={data.status} timezone={timezone} />
        {lastRun && lastRun.errors.length + lastRun.warnings.length > 0 && (
          <span className="min-w-0 max-w-full truncate text-xs text-orange-400" title={[...lastRun.errors, ...lastRun.warnings].join('\n')}>
            {[...lastRun.errors, ...lastRun.warnings][0]}
            {lastRun.errors.length + lastRun.warnings.length > 1 && ` (+${lastRun.errors.length + lastRun.warnings.length - 1} more)`}
          </span>
        )}
      </div>

      {data.migration && <MigrationBlock data={data} migration={data.migration} isAdmin={isAdmin} busy={busy === 'config'} onSource={v => void setSource(v)} />}
      {isAdmin && <BalancesBlock authed={authed} />}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">OnlyFans accounts</h3>
        {onlyfans.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No OnlyMonster accounts synced yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {inBluu.map(a => (
              <li key={a.accountId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  @{a.username ?? '—'}
                  <span className="block truncate text-[11px] text-zinc-400">
                    {a.customLabel ? `${a.customLabel} · ` : ''}
                    <span className="font-mono">{a.accountId}</span>
                  </span>
                </span>
                <span className="w-44">
                  <CreatorChip creatorId={a.creatorId!} size="xs" />
                </span>
                <AttrChip>{MATCH_LABEL[a.match]}</AttrChip>
                {isAdmin && (
                  <CreatorCombobox
                    value={a.match === 'manual' ? a.creatorId : null}
                    onChange={id => void link('account', a.accountId, id)}
                    allowedIds={data.linkTargets}
                    allLabel="Automatic (by handle)"
                    ariaLabel={`Link @${a.username ?? a.accountId} manually`}
                    className="w-44"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {notInBluu.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-zinc-400">
              Not in Bluu ({notInBluu.length}), ignored for now. Nothing is synced for these until they are linked.
            </p>
            <ul className="mt-1 divide-y divide-white/[0.07]">
              {notInBluu.map(a => (
                <li key={a.accountId} className="flex flex-wrap items-center gap-3 py-2 text-sm text-zinc-400">
                  <span className="min-w-0 flex-1">
                    @{a.username ?? '—'} <span className="font-mono text-[11px]">{a.accountId}</span>
                  </span>
                  {isAdmin && (
                    <CreatorCombobox
                      value={null}
                      onChange={id => id && void link('account', a.accountId, id)}
                      allowedIds={data.linkTargets}
                      placeholder="Link to a creator"
                      ariaLabel={`Link @${a.username ?? a.accountId} to a creator`}
                      className="w-44"
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {otherPlatforms.length > 0 && (
          <p className="mt-3 text-xs text-zinc-400">
            Not synced (OnlyFans only): {otherPlatforms.map(a => `@${a.username ?? a.accountId} (${a.platform})`).join(', ')}.
          </p>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Team members</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Used for activity figures only. Sales are credited to the agent on shift, never by OnlyMonster.
        </p>
        {data.members.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No OnlyMonster members synced yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {data.members
              .filter(m => m.listed)
              .map(m => (
                <li key={m.memberId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    {m.name ?? `Member ${m.memberId}`}
                    <span className="block truncate text-[11px] text-zinc-400">
                      {m.email ?? 'no email'} · <span className="font-mono">{m.memberId}</span>
                    </span>
                  </span>
                  <span className="w-44">
                    {m.uid ? (
                      <PersonTag name={m.displayName ?? ''} photoURL={null} size="sm" />
                    ) : (
                      <span className="text-xs text-orange-400">No Bluu user</span>
                    )}
                  </span>
                  <AttrChip>{MATCH_LABEL[m.match]}</AttrChip>
                  {isAdmin && (
                    <Select
                      value={m.match === 'manual' ? m.uid ?? '__none__' : '__none__'}
                      onValueChange={v => void link('member', m.memberId, v === '__none__' ? null : v)}
                      disabled={busy === m.memberId}
                    >
                      <SelectTrigger size="sm" className="w-44" aria-label={`Link ${m.name ?? m.memberId} manually`}>
                        <SelectValue placeholder="Link manually" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Automatic (by email)</SelectItem>
                        {activeChatAgents(users).map(u => (
                          <SelectItem key={u.uid} value={u.uid}>
                            {u.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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

/**
 * Phase 2's gate, on one screen: backfill progress, the nightly reconciliation
 * against OnlyMonster's own account totals, and the switch that moves OnlyFans
 * Analytics onto OnlyMonster (reversible, admin claim). A difference under a
 * cent reads as a match; anything else names the amount, because the gate is
 * "$0.00 or explained" (plan Phase 2).
 */
function MigrationBlock({
  data,
  migration,
  isAdmin,
  busy,
  onSource,
}: {
  data: MappingResponse;
  migration: NonNullable<MappingResponse['migration']>;
  isAdmin: boolean;
  busy: boolean;
  onSource: (v: 'buddyx' | 'onlymonster') => void;
}) {
  const { backfill, reconciliation } = migration;
  const latest = new Map<string, Reconciliation>();
  for (const r of reconciliation) if (!latest.has(`${r.creatorId}_${r.month}`)) latest.set(`${r.creatorId}_${r.month}`, r);
  const rows = [...latest.values()].sort((a, b) => b.month.localeCompare(a.month));
  const differing = rows.filter(r => Math.abs(r.diff.net) >= 0.01);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Migration</h3>
      <p className="text-sm text-zinc-300">
        History backfill:{' '}
        {backfill === null ? 'starts after the first successful sync' : backfill.done ? 'complete' : `${backfill.next} of ${backfill.total} chunks`}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-zinc-300">
          OnlyFans Analytics reads{' '}
          <span className="font-medium text-white">{data.config.analyticsSource === 'onlymonster' ? 'OnlyMonster' : 'BuddyX'}</span>
        </span>
        {isAdmin && (
          <Select value={data.config.analyticsSource} onValueChange={v => onSource(v as 'buddyx' | 'onlymonster')} disabled={busy}>
            <SelectTrigger size="sm" className="w-40" aria-label="OnlyFans Analytics source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="buddyx">BuddyX</SelectItem>
              <SelectItem value="onlymonster">OnlyMonster</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-400">No reconciliation yet. It runs with the 21:01 UTC sync.</p>
      ) : (
        <div>
          <p className={differing.length ? 'text-xs text-orange-400' : 'text-xs text-zinc-400'}>
            {differing.length
              ? `${differing.length} account-month${differing.length === 1 ? '' : 's'} differ from OnlyMonster's own totals (net).`
              : 'Every account-month matches OnlyMonster to the cent (net).'}
          </p>
          <ul className="mt-1 divide-y divide-white/[0.07]">
            {rows.map(r => (
              <li key={`${r.creatorId}_${r.month}`} className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
                <span className="w-44">
                  <CreatorChip creatorId={r.creatorId} size="xs" />
                </span>
                <span className="w-20 tabular-nums text-zinc-400">{r.month}</span>
                <span className="tabular-nums">{formatUsd(r.ledger.net)}</span>
                {Math.abs(r.diff.net) < 0.01 ? (
                  <span className="text-xs text-zinc-400">Matches</span>
                ) : (
                  <span className="text-xs text-orange-400">
                    OnlyMonster {formatUsd(r.om.net)} ({r.diff.net > 0 ? '+' : ''}
                    {formatUsd(r.diff.net)})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Creators' OnlyFans payout balances (migration plan §12) — admin claim only,
 * read-only. The daily sync reads them on a separate statements key; until that
 * key exists this says so instead of showing zeros.
 */
function BalancesBlock({ authed }: { authed: ReturnType<typeof useAuthFetch> }) {
  const [data, setData] = useState<{
    configured: boolean;
    balances: Array<{ creatorId: string; available: number; pending: number; currency: string; checkedAt: string | null }>;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    (authed('/api/admin/onlymonster/balances') as Promise<NonNullable<typeof data>>)
      .then(b => live && setData(b))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [authed]);
  if (failed) return <p className="text-xs text-orange-400">Payout balances could not be loaded. Reopen this section to try again.</p>;
  if (!data) return <Skeleton className="h-10 w-full rounded-lg" />;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Payout balances (OnlyFans)</h3>
      {!data.configured ? (
        <p className="text-xs text-zinc-400">Not connected. Balances need a separate read-only statements key (ONLYMONSTER_STATEMENTS_KEY).</p>
      ) : data.balances.length === 0 ? (
        <p className="text-xs text-zinc-400">No balances yet. They are read with the 21:01 UTC sync.</p>
      ) : (
        <ul className="divide-y divide-white/[0.07]">
          {data.balances.map(b => (
            <li key={b.creatorId} className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
              <span className="w-44"><CreatorChip creatorId={b.creatorId} size="xs" /></span>
              <span className="tabular-nums">{formatUsd(b.available)} available</span>
              <span className="tabular-nums text-zinc-400">{formatUsd(b.pending)} pending</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
