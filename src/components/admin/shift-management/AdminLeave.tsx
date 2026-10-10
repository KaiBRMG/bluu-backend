'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { HAIRLINE } from '@/lib/surfaces';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLeaveAllowances, type LeaveAllowanceRow } from '@/hooks/useLeaveAllowances';
import {
  MAX_ALLOTMENT,
  describeLeaveBalance,
  formatLeavePeriod,
  formatRemaining,
  isWholeDays,
  signedDays,
  type LeaveBalance,
} from '@/lib/leave/leaveBalance';
import { formatMonthName } from '@/lib/salary/salaryDate';
import { pluralise } from '@/lib/salary/salaryFormat';

/**
 * Shift Management → Settings → Leave: how much leave each person gets, and
 * what is left of it.
 *
 * Unpaid leave is a **monthly** allowance and paid leave a **yearly** one; a
 * request is charged to the month (or year) its shift falls in, and nothing
 * carries over or resets (`lib/leave/leaveBalance.ts`). So this table edits the
 * standing allowance, and shows the balances for the two months leave can be
 * requested in. One-off adjustments for a single month are made from the
 * person's own Leave tab, where the note they need can be written.
 */

type Draft = Record<string, { unpaid?: string; paid?: string }>;

const HEAD = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400';

export default function AdminLeave() {
  const { data, loading, error, reload, save } = useLeaveAllowances();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    if (!data) return [];
    return data.people.filter(person => {
      const d = draft[person.uid];
      if (!d) return false;
      return (
        (d.unpaid !== undefined && d.unpaid !== String(person.allotment.unpaid)) ||
        (d.paid !== undefined && d.paid !== String(person.allotment.paid))
      );
    });
  }, [data, draft]);

  const invalid = dirty.some(person => {
    const d = draft[person.uid];
    return (
      (d.unpaid !== undefined && !isWholeDays(d.unpaid, MAX_ALLOTMENT.unpaid)) ||
      (d.paid !== undefined && !isWholeDays(d.paid, MAX_ALLOTMENT.paid))
    );
  });

  if (loading && !data) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (error && !data) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-red-400">
        Couldn&apos;t load leave allowances: {error}
        <Button size="xs" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => void reload()}>
          <RotateCcw className="size-3" aria-hidden />
          Retry
        </Button>
      </p>
    );
  }

  if (!data) return null;

  const { defaults, periods } = data;

  const [thisMonth, nextMonth] = periods.unpaid;
  const year = periods.paid[0];

  async function saveAll() {
    setSaving(true);
    // People are independent: save them together, report each failure by
    // name, and reload the table once rather than once per person. The server
    // treats a value equal to the default as "follow the default".
    const results = await Promise.allSettled(
      dirty.map(person => {
        const d = draft[person.uid];
        return save(
          {
            uid: person.uid,
            allotment: {
              ...(d.unpaid !== undefined ? { unpaidPerMonth: Number(d.unpaid) } : {}),
              ...(d.paid !== undefined ? { paidPerYear: Number(d.paid) } : {}),
            },
          },
          { reload: false },
        );
      }),
    );
    await reload();
    setSaving(false);
    const failed = results.flatMap((r, i) =>
      r.status === 'rejected'
        ? [`${dirty[i].displayName}: ${r.reason instanceof Error ? r.reason.message : 'failed'}`]
        : [],
    );
    if (failed.length === 0) {
      toast.success(
        `Leave allowance saved for ${dirty.length === 1 ? dirty[0].displayName : pluralise(dirty.length, 'person', 'people')}`,
      );
      setDraft({});
    } else {
      toast.error('Some allowances were not saved', { description: failed.join(' · ') });
    }
  }

  const edit = (uid: string, field: 'unpaid' | 'paid', value: string) =>
    setDraft(prev => ({ ...prev, [uid]: { ...prev[uid], [field]: value } }));

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Leave</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-zinc-400">
            Unpaid leave is a monthly allowance (default {defaults.unpaidPerMonth}) and paid leave a yearly one (default{' '}
            {defaults.paidPerYear}). A request comes out of the month its shift is in, and unused days don&apos;t carry
            over. Open a person to add or remove days for one month.
          </p>
        </div>
        {dirty.length > 0 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft({})} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" onClick={() => void saveAll()} disabled={saving || invalid}>
              {saving ? 'Saving…' : dirty.length === 1 ? 'Save change' : `Save ${pluralise(dirty.length, 'change')}`}
            </Button>
          </div>
        )}
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label="Leave allowances, scrollable"
        className={cn(
          'overflow-x-auto rounded-lg border',
          HAIRLINE,
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
        )}
      >
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className={cn('border-b', HAIRLINE)}>
              <th scope="col" className={cn(HEAD, 'text-left')}>Employee</th>
              <th scope="col" className={cn(HEAD, 'text-left')}>Unpaid / month</th>
              <th scope="col" className={cn(HEAD, 'text-left')}>Paid / year</th>
              <th scope="col" className={cn(HEAD, 'text-right')}>Unpaid left · {shortMonth(thisMonth)}</th>
              <th scope="col" className={cn(HEAD, 'text-right')}>Unpaid left · {shortMonth(nextMonth)}</th>
              <th scope="col" className={cn(HEAD, 'text-right')}>Paid left · {year}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.045]">
            {data.people.map(person => (
              <AllowanceRow
                key={person.uid}
                person={person}
                draft={draft[person.uid]}
                onEdit={edit}
                disabled={saving}
              />
            ))}
          </tbody>
        </table>
      </div>

      {data.people.length === 0 && <p className="mt-3 text-sm text-zinc-400">No active employees.</p>}

      <p className="mt-3 text-xs text-zinc-400">
        Paid leave is switched on per person in{' '}
        <Link href="/admin-portal/user-management" prefetch={false} className="text-zinc-200 underline-offset-2 hover:underline">
          Employee Registry
        </Link>
        .
      </p>
    </section>
  );
}

function AllowanceRow({
  person,
  draft,
  onEdit,
  disabled,
}: {
  person: LeaveAllowanceRow;
  draft: Draft[string] | undefined;
  onEdit: (uid: string, field: 'unpaid' | 'paid', value: string) => void;
  disabled: boolean;
}) {
  const unpaid = draft?.unpaid ?? String(person.allotment.unpaid);
  const paid = draft?.paid ?? String(person.allotment.paid);
  const [now, next] = person.balances.unpaid;
  const year = person.balances.paid[0];

  return (
    <tr className="transition-colors duration-[120ms] hover:bg-white/[0.035]">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <span className="block truncate font-medium">{person.displayName}</span>
        {person.workEmail && <span className="block truncate text-[11px] text-zinc-400">{person.workEmail}</span>}
      </th>
      <td className="px-3 py-2">
        <AllowanceInput
          label={`${person.displayName}: unpaid days per month`}
          value={unpaid}
          max={MAX_ALLOTMENT.unpaid}
          custom={person.allotment.unpaidCustom}
          onChange={v => onEdit(person.uid, 'unpaid', v)}
          disabled={disabled}
        />
      </td>
      <td className="px-3 py-2">
        {person.hasPaidLeave ? (
          <AllowanceInput
            label={`${person.displayName}: paid days per year`}
            value={paid}
            max={MAX_ALLOTMENT.paid}
            custom={person.allotment.paidCustom}
            onChange={v => onEdit(person.uid, 'paid', v)}
            disabled={disabled}
          />
        ) : (
          <span className="text-xs text-zinc-400">No paid leave</span>
        )}
      </td>
      <BalanceCell balance={now} />
      <BalanceCell balance={next} />
      <BalanceCell balance={year} />
    </tr>
  );
}

function AllowanceInput({
  label,
  value,
  max,
  custom,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  max: number;
  custom: boolean;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const valid = isWholeDays(value, max);
  return (
    <span className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        aria-label={label}
        aria-invalid={!valid}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="h-8 w-20 text-sm tabular-nums"
      />
      {!custom && <span className="text-[11px] text-zinc-400">default</span>}
    </span>
  );
}

/** Days left, with what it is made of for anyone who asks. Negative shows as over. */
function BalanceCell({ balance }: { balance: LeaveBalance | undefined }) {
  if (!balance) return <td className="px-3 py-2 text-right text-zinc-400">—</td>;
  const detail = `${formatLeavePeriod(balance.period)}: ${describeLeaveBalance(balance)}`;
  return (
    <td className="px-3 py-2 text-right tabular-nums" title={detail}>
      <span className={cn(balance.remaining < 0 && 'text-orange-400')}>{formatRemaining(balance.remaining)}</span>
      {balance.adjustment !== 0 && (
        <span className="ml-1.5 text-[11px] text-zinc-400">({signedDays(balance.adjustment)})</span>
      )}
      <span className="sr-only"> — {detail}</span>
    </td>
  );
}

function shortMonth(period: string | undefined): string {
  return period ? formatMonthName(period, true) : '';
}
