'use client';

import { useState } from 'react';
import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MultiOption {
  value: string;
  label: string;
}

/**
 * Command-in-Popover multi-select where the stored value differs from the
 * display label (e.g. user uid vs name, group id vs name). Renders selected
 * items as removable chips.
 */
export function OptionMultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  emptyText = 'No results.',
  className,
}: {
  options: MultiOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const labelFor = (v: string) => options.find(o => o.value === v)?.label ?? v;
  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('justify-between font-normal min-h-9 h-auto', className)}
        >
          {value.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <span className="flex flex-wrap gap-1 min-w-0">
              {value.map(v => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {labelFor(v)}
                  <span
                    role="button"
                    tabIndex={0}
                    className="rounded-full hover:bg-muted-foreground/20"
                    onClick={e => { e.stopPropagation(); toggle(v); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); toggle(v); }
                    }}
                    aria-label={`Remove ${labelFor(v)}`}
                  >
                    <XIcon className="size-3" />
                  </span>
                </Badge>
              ))}
            </span>
          )}
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => toggle(option.value)}
                >
                  <CheckIcon
                    className={cn('size-4', value.includes(option.value) ? 'opacity-100' : 'opacity-0')}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
