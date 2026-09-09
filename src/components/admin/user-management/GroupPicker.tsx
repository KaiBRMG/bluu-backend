'use client';

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { AdminGroup } from '@/hooks/useAdminUsers';

/**
 * The one group picker. Used by the employee record's Groups field and by the
 * index's bulk "Add to group" action.
 *
 * It replaces `AddMembersDropdown`, which was an absolutely-positioned `<div>`
 * with a `mousedown` click-outside listener, a literal `z-50`, no focus trap,
 * no Esc, and rows built from `<div onClick>` — so the list was unreachable by
 * keyboard entirely, and the Radix `Checkbox` inside each row double-toggled
 * against the row's own handler, making a direct click on the checkbox a no-op.
 *
 * Popover + Command is the pairing DESIGN.md §5 cites for the Sharing page's
 * pickers, and it brings arrow-key navigation, type-ahead, Esc, `role="listbox"`,
 * a focus trap and focus-return to the trigger for free.
 */

/** Action Blue, inked here because shadcn's `--primary` resolves near-white
 *  in this theme (DESIGN.md §2) — same reason `FilterRail` inks its own. */
const ACTION_BLUE = '#3b82f6';

export function GroupPicker({
  groups,
  selectedIds,
  onToggle,
  trigger,
  align = 'start',
  emptyLabel = 'No groups found.',
  /** Hides groups already selected — the bulk-add case, where "remove" is not on offer. */
  addOnly = false,
}: {
  groups: AdminGroup[];
  selectedIds: string[];
  onToggle: (groupId: string, nextSelected: boolean) => void;
  trigger: React.ReactNode;
  align?: 'start' | 'end';
  emptyLabel?: string;
  addOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const options = addOnly ? groups.filter((g) => !selectedIds.includes(g.id)) : groups;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="dark w-64 p-0"
        // The named layer, never a magic z-index (DESIGN.md §4).
        style={{ zIndex: 'var(--z-overlay)' }}
      >
        <Command className="bg-transparent">
          <CommandInput placeholder="Search groups…" className="h-9" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-sm text-zinc-400">
              {emptyLabel}
            </CommandEmpty>
            <CommandGroup>
              {options.map((group) => {
                const selected = selectedIds.includes(group.id);
                return (
                  <CommandItem
                    key={group.id}
                    value={group.name}
                    onSelect={() => {
                      onToggle(group.id, !selected);
                      if (addOnly) setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <Check
                      className={cn('size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                      style={selected ? { color: ACTION_BLUE } : undefined}
                    />
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                      {group.members?.length ?? 0}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The record's Groups field: greyscale attribute chips plus an add affordance.
 *
 * Chips are greyscale on purpose. A group name is a free-form, admin-editable
 * string, and the old `groupColors.ts` hashed it into one of ten saturated
 * hues — a hue nobody can learn, that changes when someone renames the group,
 * and that put up to six saturated objects on a single row. DESIGN.md §6 bans
 * this by name and records that the same ten hues were already removed from
 * the Resources page once. An open-ended label is an Attribute chip (§5).
 */
export function GroupChips({
  groups,
  selectedIds,
  onToggle,
  disabled = false,
  busyId = null,
}: {
  groups: AdminGroup[];
  selectedIds: string[];
  onToggle: (groupId: string, nextSelected: boolean) => void;
  disabled?: boolean;
  busyId?: string | null;
}) {
  const selected = selectedIds
    .map((id) => groups.find((g) => g.id === id))
    .filter(Boolean) as AdminGroup[];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((group) => (
        <span
          key={group.id}
          className={cn(
            'inline-flex items-center gap-1 rounded-md bg-white/[0.08] py-0.5 pl-2 pr-1',
            'text-[11px] font-medium text-zinc-300',
            busyId === group.id && 'opacity-50',
          )}
        >
          {group.name}
          <button
            type="button"
            onClick={() => onToggle(group.id, false)}
            disabled={disabled || busyId === group.id}
            aria-label={`Remove from ${group.name}`}
            className={cn(
              'rounded-sm px-0.5 text-zinc-400 transition-colors hover:text-white',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
            style={{ ['--tw-ring-color' as string]: ACTION_BLUE }}
          >
            ×
          </button>
        </span>
      ))}

      {selected.length === 0 && (
        <span className="text-xs text-zinc-400">No groups — they can only reach org-wide pages.</span>
      )}

      <GroupPicker
        groups={groups}
        selectedIds={selectedIds}
        onToggle={onToggle}
        trigger={
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled}
            className="h-6 gap-1 px-1.5 text-[11px] text-zinc-400 hover:text-white"
          >
            <Plus className="size-3" />
            Add
          </Button>
        }
      />
    </div>
  );
}
