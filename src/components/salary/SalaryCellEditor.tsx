'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2Icon, Pencil, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/components/AuthProvider';
import type { SalaryDayResult, SalaryMonthResult, SalaryOverrideField } from '@/lib/salary/salaryTypes';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';

/**
 * Editing one figure on one day.
 *
 * A popover rather than an inline input, and that is the considered choice: this
 * is money. An inline cell commits on blur, which means a mis-key and a click
 * elsewhere silently changes what somebody gets paid. The popover shows what the
 * system calculated beside what you are typing, takes an optional reason, offers
 * the revert in the same place, and requires a deliberate Save.
 *
 * The response is the **recomputed month**, applied wholesale. A client-side
 * patch would be wrong more often than right: raising a day's gross can move the
 * commission tier on every later day of the month, and no optimistic update can
 * reproduce that ratchet.
 */

const FIELD_LABELS: Record<SalaryOverrideField, { title: string; help: string; step: string; prefix?: string; suffix?: string }> = {
  grossEarnings: { title: 'Gross sales', help: 'Total sales for the day. Changing this re-runs the commission tier for every later day in the month.', step: '0.01', prefix: '$' },
  hours: { title: 'Hours', help: 'Payable hours, in decimals. 7.75 is seven hours forty-five.', step: '0.25' },
  accountCount: { title: 'Accounts', help: 'Creator accounts worked. This sets the hourly rate.', step: '1' },
  hourlyRate: { title: 'Hourly rate', help: 'Overrides the rate the account count would set.', step: '0.5', prefix: '$' },
  commissionPercent: { title: 'Commission rate', help: 'Overrides the tier for this day only.', step: '0.5', suffix: '%' },
  commission: { title: 'Commission', help: 'Overrides the calculated commission for this day.', step: '0.01', prefix: '$' },
  wage: { title: 'Hourly pay', help: 'Overrides hours × rate for this day.', step: '0.01', prefix: '$' },
  salary: { title: 'Salary', help: 'Overrides the day total outright. Commission and hourly pay above are left as they are.', step: '0.01', prefix: '$' },
};

interface SalaryCellEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  day: string;
  field: SalaryOverrideField;
  label: string;
  currentValue: number;
  computedValue: number;
  override?: SalaryDayResult['overrides'][SalaryOverrideField];
  onApplied: (month: SalaryMonthResult) => void;
  children: React.ReactNode;
}

export function SalaryCellEditor({
  open,
  onOpenChange,
  userId,
  day,
  field,
  currentValue,
  computedValue,
  override,
  onApplied,
  children,
}: SalaryCellEditorProps) {
  const { user } = useAuth();
  const meta = FIELD_LABELS[field];

  const [value, setValue] = useState(String(currentValue));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed from the server's figure each time the popover opens, so a cancelled
  // edit never leaves a stale draft to be committed on the next open.
  useEffect(() => {
    if (!open) return;
    setValue(String(currentValue));
    setReason(override?.reason ?? '');
    setError(null);
    const id = window.setTimeout(() => inputRef.current?.select(), 30);
    return () => window.clearTimeout(id);
  }, [open, currentValue, override?.reason]);

  async function send(method: 'PUT' | 'DELETE') {
    if (!user) return;
    setSaving(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      let res: Response;

      if (method === 'PUT') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          setError('Enter a number.');
          setSaving(false);
          return;
        }
        res = await fetch('/api/ca-salary/override', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, day, field, value: parsed, reason: reason.trim() || undefined }),
        });
      } else {
        res = await fetch(
          `/api/ca-salary/override?userId=${encodeURIComponent(userId)}&day=${day}&field=${field}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
        );
      }

      if (!res.ok) {
        let message = `Could not save (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        setError(message);
        setSaving(false);
        return;
      }

      const month = (await res.json()) as SalaryMonthResult;
      onApplied(month);
      toast.success(
        method === 'PUT'
          ? `${meta.title} set for ${formatDayLabelWithWeekday(day)}`
          : `${meta.title} reverted to the calculated value`,
      );
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex w-full items-center justify-end gap-1 rounded-sm px-2 py-1 text-right transition-colors duration-[120ms]',
            'hover:bg-white/[0.055] active:bg-white/[0.08]',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
          )}
          aria-label={`Edit ${meta.title.toLowerCase()} for ${formatDayLabelWithWeekday(day)}`}
        >
          {children}
          {override && <Pencil className="size-3 shrink-0 text-action-blue" aria-hidden />}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-3">
        <p className="text-sm font-semibold">{meta.title}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{formatDayLabelWithWeekday(day)}</p>

        <form
          onSubmit={event => {
            event.preventDefault();
            void send('PUT');
          }}
          className="mt-3 space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor={`value-${day}-${field}`} className="text-xs">
              Value
            </Label>
            <div className="relative">
              {meta.prefix && (
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                  {meta.prefix}
                </span>
              )}
              <Input
                id={`value-${day}-${field}`}
                ref={inputRef}
                type="number"
                step={meta.step}
                value={value}
                onChange={event => setValue(event.target.value)}
                className={cn('h-8 tabular-nums', meta.prefix && 'pl-6', meta.suffix && 'pr-7')}
              />
              {meta.suffix && (
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                  {meta.suffix}
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-zinc-400">{meta.help}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`reason-${day}-${field}`} className="text-xs">
              Reason <span className="text-zinc-400">(optional)</span>
            </Label>
            <Input
              id={`reason-${day}-${field}`}
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="Agreed with agent on 3 Sep"
              className="h-8"
            />
          </div>

          {/* What the system said, so an admin can see what they are replacing
              rather than remembering it. */}
          <p className="rounded-md bg-white/[0.025] px-2.5 py-2 text-xs text-zinc-400">
            Calculated value: <span className="tabular-nums text-foreground">{computedValue}</span>
            {override && (
              <>
                {' · '}currently set by {override.setByName ?? 'an administrator'}
              </>
            )}
          </p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving} className="flex-1">
              {saving && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
              Save
            </Button>
            {override && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => void send('DELETE')}
                className="text-zinc-400"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Revert
              </Button>
            )}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
