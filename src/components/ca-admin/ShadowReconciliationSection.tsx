'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { BasisTag } from '@/components/buddyx/buddyxUi';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { formatDayLabel } from '@/lib/salary/salaryDate';
import type { useAuthFetch } from '@/hooks/useAuthFetch';

/**
 * CA Admin → Sales → **Shadow reconciliation** (migration plan Phase 3).
 *
 * The OnlyMonster pay derivation runs beside BuddyX into `ca-sales-shadow`,
 * which never reaches pay. This is where an admin judges it before the cutover:
 * the gate is seven consecutive days with every account-day equal (or explained),
 * every agent difference understood, and the strict rule's impact communicated.
 * Only differing rows are listed; a clean reading says so in words.
 */

interface ShadowReport {
  month: string;
  totals: { buddyx: number; shadow: number; onlyfans: number; shadowUnassigned: Record<string, number> };
  accountDays: Array<{ creatorId: string; day: string; buddyx: number; onlyfans: number; diff: number; chargebacks: number; explained: boolean }>;
  agentDays: Array<{ uid: string | null; name: string; day: string; buddyx: number; shadow: number; diff: number }>;
  impact: Array<{ uid: string; name: string; buddyx: number; shadow: number; diff: number }>;
  chargebacks: Record<string, number>;
  uncovered: Array<{ creatorId: string; sales: number; gross: number }>;
  boundary: { cutoverAt: string | null; omAtOrBefore: number; bxAfter: number; omPaid: number };
}

const UNASSIGNED_LABEL: Record<string, string> = {
  unscheduled: 'nobody on shift',
  overlap: 'overlapping shifts',
  departed: 'agent had left',
};

const signed = (n: number) => `${n > 0 ? '+' : ''}${formatUsd(n)}`;

export function ShadowReconciliationSection({ authed, month }: { authed: ReturnType<typeof useAuthFetch>; month: string }) {
  const [data, setData] = useState<ShadowReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (authed(`/api/admin/onlymonster/shadow?month=${month}`) as Promise<ShadowReport>)
      .then(body => live && setData(body))
      .catch(err => live && setError(err instanceof Error ? err.message : 'Could not load the shadow reconciliation'));
    return () => {
      live = false;
    };
  }, [authed, month]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <Skeleton className="h-32 w-full rounded-lg" />;

  const unassigned = Object.entries(data.totals.shadowUnassigned);
  return (
    <div className="space-y-5 text-sm">
      <p className="text-zinc-400">
        OnlyMonster&apos;s pay rows are written to a shadow ledger beside BuddyX and never reach pay. {data.month}, tips and PPV{' '}
        <BasisTag basis="gross" note="" />: BuddyX pays <span className="text-white tabular-nums">{formatUsd(data.totals.buddyx)}</span>, OnlyFans
        recorded <span className="text-white tabular-nums">{formatUsd(data.totals.onlyfans)}</span>, the shadow credits{' '}
        <span className="text-white tabular-nums">{formatUsd(data.totals.shadow)}</span>.
      </p>

      {data.boundary.cutoverAt && (
        <p className={data.boundary.omAtOrBefore || data.boundary.bxAfter ? 'text-orange-400' : 'text-zinc-300'}>
          Cutover {new Date(data.boundary.cutoverAt).toLocaleString('en-GB', { timeZone: 'Africa/Harare', dateStyle: 'medium', timeStyle: 'short' })} SAST.
          OnlyMonster pays {formatUsd(data.boundary.omPaid)} this month. Rows on the wrong side of the cutover:{' '}
          {data.boundary.omAtOrBefore + data.boundary.bxAfter === 0
            ? 'none.'
            : `${data.boundary.omAtOrBefore} OnlyMonster at or before it, ${data.boundary.bxAfter} BuddyX after it — fix before anything else.`}
        </p>
      )}

      <Block title="1. Accounts by day — paid vs OnlyFans" empty="Every account-day matches.">
        {data.accountDays.map(r => (
          <Row key={`${r.creatorId}_${r.day}`}>
            <span className="w-44"><CreatorChip creatorId={r.creatorId} size="xs" /></span>
            <span className="w-24 text-zinc-400">{formatDayLabel(r.day)}</span>
            <span className="tabular-nums">BuddyX {formatUsd(r.buddyx)} · OnlyFans {formatUsd(r.onlyfans)}</span>
            {r.explained ? (
              <span className="text-xs text-zinc-400">explained: {formatUsd(r.chargebacks)} charged back (BuddyX keeps those sales)</span>
            ) : (
              <span className="text-orange-400 tabular-nums">
                {signed(r.diff)}
                {r.chargebacks > 0 ? ` · ${formatUsd(r.chargebacks)} charged back` : ''}
              </span>
            )}
          </Row>
        ))}
      </Block>
      <p className="-mt-3 text-[11px] text-zinc-400">
        BuddyX stamps a sale up to a minute earlier than OnlyFans, so a sale just after midnight can show as a pair of opposite differences on adjacent days.
      </p>

      <Block title="2. Agents by day — BuddyX holder vs shadow" empty="Every agent-day matches.">
        {data.agentDays.map(r => (
          <Row key={`${r.uid}_${r.day}`}>
            <span className="w-44 truncate">{r.name}</span>
            <span className="w-24 text-zinc-400">{formatDayLabel(r.day)}</span>
            <span className="tabular-nums">BuddyX {formatUsd(r.buddyx)} · shadow {formatUsd(r.shadow)}</span>
            <span className={r.diff < 0 ? 'text-orange-400 tabular-nums' : 'text-zinc-300 tabular-nums'}>{signed(r.diff)}</span>
          </Row>
        ))}
      </Block>

      <Block title="3. Impact of the strict shift rule, per agent (month)" empty="No agent's month changes.">
        {data.impact.filter(r => Math.abs(r.diff) >= 0.01).map(r => (
          <Row key={r.uid}>
            <span className="w-44 truncate">{r.name}</span>
            <span className="tabular-nums">BuddyX {formatUsd(r.buddyx)} → shadow {formatUsd(r.shadow)}</span>
            <span className={r.diff < 0 ? 'text-orange-400 tabular-nums' : 'text-zinc-300 tabular-nums'}>{signed(r.diff)}</span>
          </Row>
        ))}
      </Block>
      {unassigned.length > 0 && (
        <p className="-mt-3 text-xs text-zinc-400">
          Unassigned in the shadow: {unassigned.map(([k, v]) => `${formatUsd(v)} (${UNASSIGNED_LABEL[k] ?? k})`).join(', ')}. Under the strict rule these wait for an admin or a dispute.
        </p>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">4. Chargebacks</h3>
        <p className="mt-1 text-zinc-300">
          {Object.keys(data.chargebacks).length === 0
            ? 'None this month.'
            : Object.entries(data.chargebacks).map(([k, n]) => `${n} ${k.replace('.', ' ')}`).join(' · ')}
        </p>
      </div>

      <Block title="5. Accounts BuddyX pays that OnlyMonster does not cover" empty="None. Every account BuddyX pays is covered.">
        {data.uncovered.map(r => (
          <Row key={r.creatorId}>
            <span className="w-44">{r.creatorId ? <CreatorChip creatorId={r.creatorId} size="xs" /> : 'Unmapped in BuddyX'}</span>
            <span className="tabular-nums text-orange-400">{r.sales} sales · {formatUsd(r.gross)}</span>
          </Row>
        ))}
      </Block>
    </div>
  );
}

function Block({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
      {children.length === 0 ? <p className="mt-1 text-zinc-400">{empty}</p> : <ul className="mt-1 divide-y divide-white/[0.07]">{children}</ul>}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex flex-wrap items-center gap-3 py-1.5">{children}</li>;
}
