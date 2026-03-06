"use client";

import type { AdminGroup } from '@/hooks/useAdminUsers';
import { getGroupColor } from './groupColors';

interface GroupListProps {
  groups: AdminGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (id: string) => void;
}

export default function GroupList({ groups, selectedGroupId, onSelectGroup }: GroupListProps) {
  return (
    <div
      className="w-64 flex-shrink-0 overflow-y-auto rounded-lg"
      style={{
        border: '1px solid var(--border-subtle)',
        maxHeight: '560px',
      }}
    >
      {groups.map((group) => {
        const isActive = selectedGroupId === group.id;
        const color = getGroupColor(group.name);

        return (
          <button
            key={group.id}
            onClick={() => onSelectGroup(group.id)}
            className="w-full flex items-center gap-3 px-3 py-3 text-left text-sm transition-colors"
            style={{
              background: isActive ? 'var(--active-background)' : 'transparent',
              borderBottom: '1px solid var(--border-subtle)',
              color: isActive ? 'var(--foreground)' : 'var(--foreground-secondary)',
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = 'var(--hover-background)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            {/* Color accent */}
            <div
              className="w-1 h-8 rounded-full flex-shrink-0"
              style={{ background: color }}
            />

            <div className="flex-1 min-w-0">
              <span className={`block truncate ${isActive ? 'font-medium' : ''}`}>
                {group.name}
              </span>
            </div>

            {/* Member count badge */}
            <span
              className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--foreground-muted)',
              }}
            >
              {group.members?.length || 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
