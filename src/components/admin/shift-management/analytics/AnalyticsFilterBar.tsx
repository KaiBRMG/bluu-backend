'use client';

import { useMemo, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import type { AnalyticsScope } from '@/hooks/useAnalyticsData';
import { TimeRangePicker } from './TimeRangePicker';
import type { PresetId, DateRange } from './analyticsTypes';

interface AnalyticsFilterBarProps {
  scope: AnalyticsScope;
  onScopeChange: (scope: AnalyticsScope) => void;
  selectedUserId: string | null;
  onUserChange: (uid: string | null) => void;
  selectedGroupId: string | null;
  onGroupChange: (groupId: string | null) => void;
  preset: PresetId;
  range: DateRange;
  onRangeChange: (preset: PresetId, range: DateRange) => void;
}

const SCOPE_LABELS: Record<AnalyticsScope, string> = {
  company: 'Company-wide',
  group: 'Group',
  user: 'Individual',
};

export function AnalyticsFilterBar({
  scope, onScopeChange,
  selectedUserId, onUserChange,
  selectedGroupId, onGroupChange,
  preset, range, onRangeChange,
}: AnalyticsFilterBarProps) {
  const { users, groups, loading } = useBasicUsers();
  const [userOpen, setUserOpen] = useState(false);

  // Archived users are excluded everywhere they can be picked.
  const activeUsers = useMemo(
    () => users
      .filter(u => !u.isArchived)
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', undefined, { sensitivity: 'base' })),
    [users],
  );

  const selectedUser = activeUsers.find(u => u.uid === selectedUserId);
  const selectedGroup = (groups as Array<{ groupId?: string; id?: string; name?: string }>)
    .find(g => (g.groupId ?? g.id) === selectedGroupId);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      {/* Scope */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="form-input flex items-center justify-between gap-2"
            style={{ cursor: 'pointer', minWidth: '150px' }}
          >
            <span>{SCOPE_LABELS[scope]}</span>
            <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="dark min-w-[160px]">
          {(Object.keys(SCOPE_LABELS) as AnalyticsScope[]).map(s => (
            <DropdownMenuItem key={s} onSelect={() => onScopeChange(s)}>
              {SCOPE_LABELS[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Entity — only where it means something */}
      {scope === 'user' && (
        <Popover open={userOpen} onOpenChange={setUserOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="form-input flex items-center justify-between gap-2"
              style={{ cursor: 'pointer', minWidth: '180px' }}
              disabled={loading}
            >
              <span>{selectedUser?.displayName ?? 'Select a user...'}</span>
              <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[220px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search employee..." />
              <CommandList>
                <CommandEmpty>No employee found.</CommandEmpty>
                <CommandGroup>
                  {activeUsers.map(u => (
                    <CommandItem
                      key={u.uid}
                      value={u.displayName || `${u.firstName} ${u.lastName}`}
                      onSelect={() => { onUserChange(u.uid); setUserOpen(false); }}
                    >
                      {u.displayName || `${u.firstName} ${u.lastName}`}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {scope === 'group' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="form-input flex items-center justify-between gap-2"
              style={{ cursor: 'pointer', minWidth: '150px' }}
              disabled={loading}
            >
              <span>{selectedGroup?.name ?? 'Select a group...'}</span>
              <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="dark min-w-[160px]">
            {(groups as Array<{ groupId?: string; id?: string; name?: string }>).map(g => {
              const id = g.groupId ?? g.id ?? '';
              return (
                <DropdownMenuItem key={id} onSelect={() => onGroupChange(id)}>
                  {g.name ?? id}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="ml-auto">
        <TimeRangePicker preset={preset} range={range} onChange={onRangeChange} />
      </div>
    </div>
  );
}
