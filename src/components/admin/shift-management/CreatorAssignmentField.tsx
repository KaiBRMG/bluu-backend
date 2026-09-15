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
import { useCreators } from '@/hooks/useCreators';
import { formatUsd } from '@/lib/salary/salaryFormat';
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
 */

interface CreatorAssignmentFieldProps {
  value: string[];
  onChange: (creatorIds: string[]) => void;
  /** Account count → $/hour, from the salary config. Omit to hide the rate line. */
  wageTiers?: Record<number, number>;
  /** Soft cap from the roster rules; exceeding it warns rather than blocks. */
  maxAccounts?: number;
  disabled?: boolean;
}

export function CreatorAssignmentField({
  value,
  onChange,
  wageTiers,
  maxAccounts = 5,
  disabled,
}: CreatorAssignmentFieldProps) {
  const creators = useCreators();
  const [open, setOpen] = useState(false);

  const byId = useMemo(() => {
    const map = new Map<string, string>();
    for (const creator of creators) map.set(creator.creatorID, creator.stageName);
    return map;
  }, [creators]);

  const rate = useMemo(() => {
    if (!wageTiers || value.length === 0) return null;
    const counts = Object.keys(wageTiers).map(Number).sort((a, b) => a - b);
    if (counts.length === 0) return null;
    const clamped = Math.min(Math.max(value.length, counts[0]), counts[counts.length - 1]);
    let found = wageTiers[counts[0]];
    for (const count of counts) if (clamped >= count) found = wageTiers[count];
    return found;
  }, [wageTiers, value.length]);

  const toggle = (creatorId: string) => {
    onChange(value.includes(creatorId) ? value.filter(id => id !== creatorId) : [...value, creatorId]);
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
            <CommandInput placeholder="Search creators…" />
            <CommandList>
              <CommandEmpty>No creators found.</CommandEmpty>
              <CommandGroup>
                {creators.map(creator => {
                  const selected = value.includes(creator.creatorID);
                  return (
                    <CommandItem
                      key={creator.creatorID}
                      value={creator.stageName}
                      onSelect={() => toggle(creator.creatorID)}
                    >
                      <Check className={cn('size-4', selected ? 'opacity-100' : 'opacity-0')} aria-hidden />
                      <CreatorChip
                        creatorId={creator.creatorID}
                        name={creator.stageName}
                        photoURL={creator.photoURL}
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
        <ul className="flex flex-wrap gap-1 pt-0.5">
          {value.map(id => (
            <li key={id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(id)}
                className="inline-flex items-center gap-1 rounded-full transition-opacity duration-[120ms] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
                aria-label={`Remove ${byId.get(id) ?? id}`}
              >
                <CreatorChip creatorId={id} className="pr-1" />
                <X className="mr-1 size-3 text-zinc-400" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The consequence, stated. This field pays money. */}
      <p className={cn('text-xs leading-relaxed', overCap ? 'text-orange-400' : 'text-zinc-400')}>
        {value.length === 0 ? (
          <>No accounts means no hourly pay for this shift — only commission on any sales.</>
        ) : overCap ? (
          <>
            {value.length} accounts is over the {maxAccounts}-account limit for a shift.
            {rate !== null && <> Pays {formatUsd(rate)}/hour.</>}
          </>
        ) : (
          <>
            {rate !== null && (
              <>
                Pays <span className="tabular-nums text-foreground">{formatUsd(rate)}/hour</span> for this shift.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
