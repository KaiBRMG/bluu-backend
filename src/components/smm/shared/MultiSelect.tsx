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

/**
 * Command-in-Popover multi-select with removable Badge chips
 * (CreateNotificationDialog recipients pattern). Used for the account
 * 'type' field.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className,
}: {
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (option: string) => {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
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
              {value.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {v}
                  <span
                    role="button"
                    tabIndex={0}
                    className="rounded-full hover:bg-muted-foreground/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        toggle(v);
                      }
                    }}
                    aria-label={`Remove ${v}`}
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
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-48 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option} value={option} onSelect={() => toggle(option)}>
                  <CheckIcon className={cn('size-4', value.includes(option) ? 'opacity-100' : 'opacity-0')} />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
