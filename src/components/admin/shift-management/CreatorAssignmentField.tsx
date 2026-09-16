'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useAssignableAccounts } from '@/hooks/useCreators';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { splitShiftAccounts } from '@/lib/salary/shiftAccounts';
import { CreatorChip } from '@/components/creators/CreatorChip';

/**
 * Which creator accounts a shift covers.
 *
 * This field is not scheduling metadata — **the number of chips here sets the
 * agent's hourly wage for that day**. That is why the rate is shown live under
 * the picker rather than left implicit: an admin adding a fourth account is
 * giving someone a raise for that shift, and should see it happen.
 *
 * A `Popover` + `Command` multi-select, matching the Sharing page's pickers, so
 * search-then-toggle behaves the same everywhere in the admin surfaces.
 *
 * ## Sub-accounts are peers, and the list says so
 *
 * A creator's secondary accounts ("Cole (Fansly)") are listed **as their own
 * rows**, indented under the parent. One agent can be assigned Cole and another
 * Cole (Fansly); each row is one account and counts once toward whoever holds
 * it. The indent is grouping, not hierarchy of importance — nothing about
 * selecting a parent selects its children, because they are genuinely separate
 * assignments.
 *
 * Searching matches the full name ("Cole (Fansly)") *and* the parent's, so
 * typing "cole" surfaces the whole family.
 *
 * ## Regular vs overtime, per account
 *
 * The same shift can hold both. An agent who works three accounts and picks up
 * two more *inside those same hours* is still paid the three-account rate — they
 * keep the sales, not a raise (ca-salary.md §6). Before this control existed the
 * only way to record that was the coverage board's zero-wage shift, so an admin
 * adding the accounts by hand here silently moved the agent from $3.50 to
 * $5.50/hour.
 *
 * Each selected account therefore carries a two-state toggle, and the line
 * beneath restates the rate from the **paid** count only. The toggle is a
 * segmented pair rather than a checkbox because neither state is the absence of
 * the other — "regular" is a claim about pay, and an admin should be reading it,
 * not inferring it from an unticked box.
 */

interface CreatorAssignmentFieldProps {
  value: string[];
  onChange: (creatorIds: string[]) => void;
  /** The subset of `value` worked as overtime — no extra pay, no higher tier. */
  overtimeValue: string[];
  onOvertimeChange: (creatorIds: string[]) => void;
  /** Account count → $/hour, from the salary config. Omit to hide the rate line. */
  wageTiers?: Record<number, number>;
  /** Soft cap from the roster rules; exceeding it warns rather than blocks. */
  maxAccounts?: number;
  /**
   * False for a shift that pays no hourly wage at all — in-shift cover created
   * from the Coverage board. The rate line must not quote a figure there: the
   * accounts are real and the rate is zero, and the two together read as a
   * promise the payslip will not keep.
   */
  paysWage?: boolean;
  disabled?: boolean;
}

export function CreatorAssignmentField({
  value,
  onChange,
  overtimeValue,
  onOvertimeChange,
  wageTiers,
  maxAccounts = 5,
  paysWage = true,
  disabled,
}: CreatorAssignmentFieldProps) {
  const accounts = useAssignableAccounts();
  const [open, setOpen] = useState(false);

  const byId = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts) map.set(account.creatorID, account.stageName);
    return map;
  }, [accounts]);

  const overtimeSet = useMemo(() => new Set(overtimeValue), [overtimeValue]);
  // The count that sets the rate. Normally the assignment minus the overtime
  // accounts — but a shift that is *entirely* overtime is an overtime shift and
  // pays on all of it, so the marking there is only telling the agent what kind
  // of shift they are looking at. One helper, shared with the engine.
  const split = useMemo(() => splitShiftAccounts(value, overtimeValue), [value, overtimeValue]);
  const paidCount = split.paidIds.length;
  const overtimeCount = split.overtimeIds.length;

  const rate = useMemo(() => {
    if (!wageTiers || paidCount === 0) return null;
    const counts = Object.keys(wageTiers).map(Number).sort((a, b) => a - b);
    if (counts.length === 0) return null;
    const clamped = Math.min(Math.max(paidCount, counts[0]), counts[counts.length - 1]);
    let found = wageTiers[counts[0]];
    for (const count of counts) if (clamped >= count) found = wageTiers[count];
    return found;
  }, [wageTiers, paidCount]);

  const toggle = (creatorId: string) => {
    if (value.includes(creatorId)) {
      onChange(value.filter(id => id !== creatorId));
      // Removing the account removes its overtime mark with it. The server
      // intersects anyway, but leaving a ghost here would make the rate line
      // above disagree with what saving actually produces.
      if (overtimeSet.has(creatorId)) onOvertimeChange(overtimeValue.filter(id => id !== creatorId));
    } else {
      onChange([...value, creatorId]);
    }
  };

  const setOvertime = (creatorId: string, isOvertime: boolean) => {
    if (isOvertime) {
      if (!overtimeSet.has(creatorId)) onOvertimeChange([...overtimeValue, creatorId]);
    } else {
      onOvertimeChange(overtimeValue.filter(id => id !== creatorId));
    }
  };

  const overCap = value.length > maxAccounts;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="creator-assignment">Creator accounts</Label>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="creator-assignment"
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn('truncate', value.length === 0 && 'text-zinc-400')}>
              {value.length === 0
                ? 'None assigned'
                : `${value.length} account${value.length === 1 ? '' : 's'}`}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search accounts…" />
            <CommandList>
              <CommandEmpty>No accounts found.</CommandEmpty>
              <CommandGroup>
                {accounts.map(account => {
                  const selected = value.includes(account.creatorID);
                  return (
                    <CommandItem
                      key={account.creatorID}
                      // Both names, so "cole" finds Cole and Cole (Fansly).
                      value={`${account.stageName} ${account.parentStageName ?? ''}`}
                      onSelect={() => toggle(account.creatorID)}
                      className={cn(account.isSubAccount && 'pl-7')}
                    >
                      <Check className={cn('size-4', selected ? 'opacity-100' : 'opacity-0')} aria-hidden />
                      <CreatorChip
                        creatorId={account.creatorID}
                        name={account.stageName}
                        photoURL={account.photoThumb ?? account.photoURL}
                        className="bg-transparent pr-0"
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <ul className="space-y-1 pt-0.5">
          {value.map(id => {
            const isOvertime = overtimeSet.has(id);
            const name = byId.get(id) ?? id;
            return (
              <li
                key={id}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1',
                  isOvertime && paysWage
                    ? 'border-orange-500/30 bg-orange-500/[0.06]'
                    : 'border-white/[0.07] bg-white/[0.03]',
                )}
              >
                <CreatorChip creatorId={id} overtime={isOvertime && paysWage} className="min-w-0 bg-transparent pr-0" />

                {/* Two buttons, not a checkbox: "regular" is a claim about pay,
                    and it should be read rather than inferred from an empty box.
                    Absent on a zero-wage cover shift, where neither setting can
                    change anything — an inert control that looks live is worse
                    than no control. */}
                {paysWage && <span
                  role="group"
                  aria-label={`Pay basis for ${name}`}
                  className="ml-auto flex shrink-0 overflow-hidden rounded-md border border-white/[0.09]"
                >
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={!isOvertime}
                    onClick={() => setOvertime(id, false)}
                    className={cn(
                      'px-2 py-0.5 text-[10px] font-medium transition-colors duration-[120ms]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]',
                      !isOvertime ? 'bg-white/[0.12] text-foreground' : 'text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    Regular
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={isOvertime}
                    onClick={() => setOvertime(id, true)}
                    title="Worked inside this shift for the sales only — adds no hours and does not raise the hourly rate."
                    className={cn(
                      'px-2 py-0.5 text-[10px] font-medium transition-colors duration-[120ms]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]',
                      isOvertime ? 'bg-orange-500/25 text-orange-300' : 'text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    Overtime
                  </button>
                </span>}

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(id)}
                  aria-label={`Remove ${name}`}
                  className="shrink-0 rounded-sm p-0.5 text-zinc-500 transition-colors duration-[120ms] hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* The consequence, stated. This field pays money. */}
      <p className={cn('text-xs leading-relaxed', overCap ? 'text-orange-400' : 'text-zinc-400')}>
        {!paysWage ? (
          // A cover shift assigned from the board. It carries accounts and pays
          // no hours by design, so quoting a rate here — which this line did —
          // describes a payment that will never be made.
          <span className="text-orange-400">
            In-shift cover: worked inside a shift that is already being paid for. No hourly wage and no rate,
            whatever is assigned here — the agent keeps the sales only.
          </span>
        ) : value.length === 0 ? (
          <>No accounts means no hourly pay for this shift — only commission on any sales.</>
        ) : split.isFullyOvertime ? (
          // Every account marked: an overtime shift, which pays on all of them.
          // Stated rather than left to inference, because the mixed case one
          // account away subtracts instead — and an admin needs to know which
          // side of that line they are on before they save.
          <>
            {rate !== null && (
              <>
                Overtime shift — pays{' '}
                <span className="tabular-nums text-foreground">{formatUsd(rate)}/hour</span> on all{' '}
                {value.length} account{value.length === 1 ? '' : 's'}.
              </>
            )}{' '}
            <span className="text-orange-400">
              Add a regular account and the overtime ones stop counting toward the rate.
            </span>
          </>
        ) : (
          <>
            {rate !== null && (
              <>
                Pays <span className="tabular-nums text-foreground">{formatUsd(rate)}/hour</span> for this shift
                {overtimeCount > 0 && <> on {paidCount} regular account{paidCount === 1 ? '' : 's'}</>}.
              </>
            )}
            {overtimeCount > 0 && (
              <>
                {' '}
                <span className="text-orange-400">
                  {overtimeCount} overtime account{overtimeCount === 1 ? '' : 's'}
                </span>{' '}
                worked inside these same hours — the agent keeps the sales, the rate does not move.
              </>
            )}
            {overCap && (
              <>
                {' '}
                {value.length} accounts is over the {maxAccounts}-account limit for a shift.
              </>
            )}
          </>
        )}
      </p>

    </div>
  );
}
