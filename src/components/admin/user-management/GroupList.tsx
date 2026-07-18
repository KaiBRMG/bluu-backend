"use client";

import { cn } from '@/lib/utils';
import type { AdminGroup } from '@/hooks/useAdminUsers';
import { getGroupColor } from './groupColors';

interface GroupListProps {
  groups: AdminGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (id: string) => void;
}

export default function GroupList({ groups, selectedGroupId, onSelectGroup }: GroupListProps) {
  return (
    <div className="w-64 flex-shrink-0 overflow-y-auto rounded-lg border border-border-subtle max-h-[560px]">
      {groups.map((group) => {
        const isActive = selectedGroupId === group.id;
        const color = getGroupColor(group.name);

        return (
          <button
            key={group.id}
            onClick={() => onSelectGroup(group.id)}
            className={cn(
              'flex w-full items-center gap-3 border-b px-3 py-3 text-left text-sm transition-colors border-border-subtle',
              isActive
                ? 'bg-active-bg text-foreground'
                : 'text-foreground-secondary hover:bg-hover-bg'
            )}
          >
            <div
              className="h-8 w-1 flex-shrink-0 rounded-full"
              style={{ background: color }}
            />

            <span className={cn('min-w-0 flex-1 truncate', isActive && 'font-medium')}>
              {group.name}
            </span>

            <span className="flex-shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-foreground-muted tabular-nums">
              {group.members?.length || 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
