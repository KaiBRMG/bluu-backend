'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Pick an existing label or coin a new one in the same control. The "create"
 * row only appears once what has been typed is genuinely new, so the common
 * case — reusing a label — never shows a create affordance to click past.
 */
export function CategoryPicker({
  options,
  value,
  onChange,
  onCreate,
  id,
  invalid = false,
  describedBy,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onCreate: (value: string) => Promise<void> | void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const typed = normalise(draft);
  const isNew = typed.length > 0 && !options.some(o => o.toLowerCase() === typed.toLowerCase());

  const commit = async (label: string) => {
    const clean = normalise(label);
    if (!clean) return;
    if (!options.some(o => o.toLowerCase() === clean.toLowerCase())) await onCreate(clean);
    onChange(clean);
    setDraft('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          // No `aria-invalid` — it isn't supported on role="button". The error
          // reaches assistive tech through `aria-describedby` instead.
          aria-describedby={describedBy}
          className={`flex h-9 w-full items-center justify-between rounded-lg border bg-zinc-800 px-3 text-sm transition-colors focus:border-zinc-500 focus:outline-none ${
            invalid ? 'border-red-500' : 'border-zinc-700'
          }`}
        >
          <span className={value ? 'text-white' : 'text-zinc-400'}>
            {value || 'Choose or create a category'}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-zinc-400" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search or type a new category…"
            value={draft}
            onValueChange={setDraft}
          />
          <CommandList>
            {!isNew && <CommandEmpty>No categories yet — type one to create it.</CommandEmpty>}
            {isNew && (
              <CommandGroup>
                <CommandItem value={`__create__${typed}`} onSelect={() => commit(typed)}>
                  <Plus className="size-4" aria-hidden />
                  Create “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
            {options.length > 0 && (
              <CommandGroup heading="Categories">
                {options.map(option => (
                  <CommandItem key={option} value={option} onSelect={() => commit(option)}>
                    <Check
                      className={`size-4 ${option === value ? 'opacity-100' : 'opacity-0'}`}
                      aria-hidden
                    />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Multi-select sibling of CategoryPicker. Selected tags render as removable
 * chips beneath the control so the current selection is readable without
 * opening the list.
 */
export function TagPicker({ options, value, onChange, onCreate, id }: {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  onCreate: (value: string) => Promise<void> | void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const typed = normalise(draft);
  const isNew = typed.length > 0 && !options.some(o => o.toLowerCase() === typed.toLowerCase());
  const selected = useMemo(() => new Set(value.map(v => v.toLowerCase())), [value]);

  const toggle = async (label: string) => {
    const clean = normalise(label);
    if (!clean) return;
    if (!options.some(o => o.toLowerCase() === clean.toLowerCase())) await onCreate(clean);

    onChange(
      selected.has(clean.toLowerCase())
        ? value.filter(v => v.toLowerCase() !== clean.toLowerCase())
        : [...value, clean]
    );
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            className="flex h-9 w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm transition-colors focus:border-zinc-500 focus:outline-none"
          >
            <span className={value.length ? 'text-white' : 'text-zinc-400'}>
              {value.length ? `${value.length} selected` : 'Choose or create tags'}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-zinc-400" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search or type a new tag…"
              value={draft}
              onValueChange={setDraft}
            />
            <CommandList>
              {!isNew && <CommandEmpty>No tags yet — type one to create it.</CommandEmpty>}
              {isNew && (
                <CommandGroup>
                  <CommandItem value={`__create__${typed}`} onSelect={() => toggle(typed)}>
                    <Plus className="size-4" aria-hidden />
                    Create “{typed}”
                  </CommandItem>
                </CommandGroup>
              )}
              {options.length > 0 && (
                <CommandGroup heading="Tags">
                  {options.map(option => (
                    <CommandItem key={option} value={option} onSelect={() => toggle(option)}>
                      <Check
                        className={`size-4 ${selected.has(option.toLowerCase()) ? 'opacity-100' : 'opacity-0'}`}
                        aria-hidden
                      />
                      {option}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map(tag => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => onChange(value.filter(v => v !== tag))}
                className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] py-0.5 pl-2.5 pr-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
              >
                {tag}
                <X className="size-3" aria-hidden />
                <span className="sr-only">Remove tag</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { normalise as normaliseLabel };
