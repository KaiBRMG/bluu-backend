'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useLeaveAllowances } from '@/hooks/useLeaveAllowances';
import {
  MAX_ADJUSTMENT,
  MAX_ALLOTMENT,
  describeLeaveBalance,
  formatLeavePeriod,
  formatRemaining,
  isWholeDays,
  type LeaveBalance,
} from '@/lib/leave/leaveBalance';
import { SURFACE } from '@/lib/surfaces';

/**
 * One person's leave: their standing allowance, and each balance they can
 * currently spend with a one-off adjustment for that period.
 *
 * Balances are derived (`lib/leave/leaveBalance.ts`) — allowance + adjustment −
 * requests in the period — so this never types a "remaining" number. An
 * adjustment is the only way to give or take days for one month, and it needs
 * a note, because "why does she have six days in November" is a question
 * someone will ask. Every change lands in the leave ledger with who made it.
 */
export function PersonLeave({ uid }: { uid: string }) {
  const { data, loading, error, save } = useLeaveAllowances(uid);
  const person = data?.people[0];

  // Drafts over the saved figures, rather than state copied from props: a
  // reload after saving shows the new figures with nothing to re-sync.
  const [unpaidDraft, setUnpaid] = useState<string | undefined>();
  const [paidDraft, setPaid] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  if (loading && !data) return <Skeleton className="h-56 w-full max-w-md rounded-xl" />;
  if (error && !data) return <p className="text-sm text-zinc-400">Couldn&apos;t load leave: {error}</p>;
  if (!person) return <p className="text-sm text-zinc-400">No record for this person.</p>;

  const savedUnpaid = String(person.allotment.unpaid);
  const savedPaid = String(person.allotment.paid);
  const unpaid = unpaidDraft ?? savedUnpaid;
  const paid = paidDraft ?? savedPaid;
  const valid = isWholeDays;
  const dirty = unpaid !== savedUnpaid || (person.hasPaidLeave && paid !== savedPaid);
  const canSave = dirty && valid(unpaid, MAX_ALLOTMENT.unpaid) && valid(paid, MAX_ALLOTMENT.paid) && !saving;

  const saveAllotment = async () => {
    setSaving(true);
    try {
      // The server treats a value equal to the default as "follow the default".
      await save({
        uid,
        allotment: {
          unpaidPerMonth: Number(unpaid),
          ...(person.hasPaidLeave ? { paidPerYear: Number(paid) } : {}),
        },
      });
      setUnpaid(undefined);
      setPaid(undefined);
      toast.success(`Leave allowance saved for ${person.displayName}`);
    } catch (err) {
      toast.error('Could not save the allowance', { description: err instanceof Error ? err.message : 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const balances = [...person.balances.unpaid, ...person.balances.paid];

  return (
    <div className="max-w-md space-y-4">
      <section className={cn('rounded-xl p-4', SURFACE)}>
        <h3 className="text-sm font-medium">Allowance</h3>
        <p className="mt-0.5 text-xs text-zinc-400">
          Days they get every month (unpaid) and every year (paid). Unused days don&apos;t carry over.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="leave-unpaid" className="mb-1 text-xs text-zinc-400">
              Unpaid per month
            </Label>
            <Input
              id="leave-unpaid"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_ALLOTMENT.unpaid}
              className="form-input h-9 tabular-nums"
              aria-invalid={!valid(unpaid, MAX_ALLOTMENT.unpaid)}
              value={unpaid}
              onChange={e => setUnpaid(e.target.value)}
            />
            {!person.allotment.unpaidCustom && <p className="mt-1 text-[11px] text-zinc-400">Default</p>}
          </div>
          <div>
            <Label htmlFor="leave-paid" className="mb-1 text-xs text-zinc-400">
              Paid per year
            </Label>
            <Input
              id="leave-paid"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_ALLOTMENT.paid}
              className="form-input h-9 tabular-nums"
              aria-invalid={!valid(paid, MAX_ALLOTMENT.paid)}
              value={paid}
              onChange={e => setPaid(e.target.value)}
              disabled={!person.hasPaidLeave}
            />
            {person.hasPaidLeave && !person.allotment.paidCustom && (
              <p className="mt-1 text-[11px] text-zinc-400">Default</p>
            )}
          </div>
        </div>

        {!person.hasPaidLeave && (
          <p className="mt-2 text-[11px] text-zinc-400">
            Paid leave is off for this person. Turn it on in{' '}
            <Link href="/admin-portal/user-management" prefetch={false} className="text-zinc-200 underline-offset-2 hover:underline">
              Employee Registry
            </Link>
            .
          </p>
        )}

        {dirty && (
          <div className="mt-4 flex justify-end gap-2 border-t border-white/[0.07] pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setUnpaid(undefined);
                setPaid(undefined);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void saveAllotment()} disabled={!canSave}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </section>

      <section className={cn('rounded-xl p-4', SURFACE)}>
        <h3 className="text-sm font-medium">Balances</h3>
        <p className="mt-0.5 text-xs text-zinc-400">
          The periods leave can be requested in now. Adjust one to give or take days for that period only.
        </p>
        <ul className="mt-3 divide-y divide-white/[0.06]">
          {balances.map(balance => (
            <BalanceLine
              key={`${balance.type}:${balance.period}`}
              balance={balance}
              onSave={(days, note) => save({ uid, adjustment: { type: balance.type, period: balance.period, days, note } })}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function BalanceLine({ balance, onSave }: { balance: LeaveBalance; onSave: (days: number, note: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState(String(balance.adjustment));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = `adjust-${balance.type}-${balance.period}`;
  const parsed = Number(days);
  const daysValid = /^-?\d+$/.test(days.trim()) && Math.abs(parsed) <= MAX_ADJUSTMENT;
  const needsNote = parsed !== 0;
  const changed = daysValid && parsed !== balance.adjustment;
  const canSave = changed && (!needsNote || note.trim().length >= 3) && !busy;
  const label = `${balance.type === 'paid' ? 'Paid' : 'Unpaid'} · ${formatLeavePeriod(balance.period)}`;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(parsed, note.trim());
      toast.success(parsed === 0 ? `Adjustment removed for ${label}` : `Adjustment saved for ${label}`);
      setEditing(false);
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the adjustment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm">{label}</p>
          <p className="text-[11px] tabular-nums text-zinc-400">{describeLeaveBalance(balance)}</p>
        </div>
        <div className="flex shrink-0 items-baseline gap-3">
          <span className={cn('text-lg font-semibold tabular-nums', balance.remaining < 0 && 'text-orange-400')}>
            {formatRemaining(balance.remaining)}
            <span className="sr-only"> left</span>
          </span>
          {!editing && (
            <Button
              size="xs"
              variant="ghost"
              className="text-zinc-300"
              onClick={() => {
                setDays(String(balance.adjustment));
                setEditing(true);
              }}
              aria-label={`Adjust ${label}`}
            >
              Adjust
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-2 space-y-2 rounded-md border border-white/[0.07] p-2.5">
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor={`${id}-days`} className="mb-1 text-xs text-zinc-400">
                Days ±
              </Label>
              <Input
                id={`${id}-days`}
                inputMode="numeric"
                className="h-8 w-20 tabular-nums"
                aria-invalid={!daysValid}
                aria-describedby={`${id}-hint`}
                value={days}
                onChange={e => setDays(e.target.value)}
              />
            </div>
            <p id={`${id}-hint`} className="pb-1.5 text-[11px] text-zinc-400">
              The total adjustment for this period, e.g. 2 or -1. 0 removes it.
            </p>
          </div>
          {needsNote && (
            <div>
              <Label htmlFor={`${id}-note`} className="mb-1 text-xs text-zinc-400">
                Why <span className="text-zinc-400">(required)</span>
              </Label>
              <Input
                id={`${id}-note`}
                className="h-8"
                maxLength={280}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Family event, agreed with the CA lead"
              />
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={!canSave}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
