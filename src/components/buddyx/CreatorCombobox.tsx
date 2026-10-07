'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { useCreators } from '@/hooks/useCreators';

/**
 * Pick one creator (or sub-account) from the shared roster — Popover + Command,
 * the house combobox. `allowedIds` narrows the list (OnlyFans-mapped creators
 * for the dispute dialog, the agent's roster for Fan Analytics); `null` means
 * the whole roster. `allLabel` adds a "none selected" first item.
 */
export function CreatorCombobox({
  value,
  onChange,
  allowedIds = null,
  allLabel,
  placeholder = 'Pick a creator',
  className,
  ariaLabel = 'Creator',
}: {
  value: string | null;
  onChange: (creatorId: string | null) => void;
  allowedIds?: string[] | null;
  allLabel?: string;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const creators = useCreators();
  const [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const allowed = allowedIds ? new Set(allowedIds) : null;
    return creators
      .filter(c => (!allowed || allowed.has(c.creatorID)) && !(c as { isArchived?: boolean }).isArchived)
      .sort((a, b) => a.stageName.localeCompare(b.stageName));
  }, [creators, allowedIds]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn('w-52 justify-between font-normal', className)}
        >
          {value ? <CreatorChip creatorId={value} size="xs" /> : <span className="text-zinc-400">{allLabel ?? placeholder}</span>}
          <ChevronsUpDown className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search creators" />
          <CommandList>
            <CommandEmpty>No creator matches.</CommandEmpty>
            <CommandGroup>
              {allLabel && (
                <CommandItem value={`__all__ ${allLabel}`} onSelect={() => { onChange(null); setOpen(false); }}>
                  <Check className={cn('size-3.5', value === null ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  {allLabel}
                </CommandItem>
              )}
              {options.map(c => (
                <CommandItem
                  key={c.creatorID}
                  value={`${c.stageName} ${c.creatorID}`}
                  onSelect={() => { onChange(c.creatorID); setOpen(false); }}
                >
                  <Check className={cn('size-3.5', value === c.creatorID ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <CreatorChip creatorId={c.creatorID} size="xs" />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
