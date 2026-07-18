"use client";

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import { getGroupBadgeStyle } from './groupColors';

import { getAvatarColor, getInitials } from '@/lib/utils/avatar';

interface UserCardProps {
  user: AdminFullUser;
  groups: AdminGroup[];
  onClick: () => void;
}

export default function UserCard({ user, groups, onClick }: UserCardProps) {
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName;
  const isActive = user.isActive !== false;
  const userGroups = (user.groups || [])
    .map((id) => groups.find((g) => g.id === id))
    .filter(Boolean) as AdminGroup[];

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-full rounded-lg p-4 text-left transition-colors bg-container-bg border border-border-subtle hover:bg-hover-bg hover:border-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span
        className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
        style={{
          color: isActive ? '#22c55e' : '#ef4444',
          background: isActive ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
        }}
      >
        <span
          className="inline-block size-1.5 rounded-full"
          style={{ background: isActive ? '#22c55e' : '#ef4444' }}
        />
        {isActive ? 'Active' : 'Disabled'}
      </span>

      <div className="flex items-start gap-3">
        <Avatar style={{ background: getAvatarColor((user.displayName || fullName) || 'User') }}>
          {user.photoURL && <AvatarImage src={user.photoURL} alt={user.displayName || fullName} />}
          <AvatarFallback style={{ background: getAvatarColor((user.displayName || fullName) || 'User'), color: '#fff' }}>
            {getInitials(user.displayName || fullName)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0 pr-16">
          <span className="block truncate text-sm font-medium text-foreground">
            {fullName}
          </span>

          {user.displayName && user.displayName !== fullName && (
            <div className="truncate text-xs text-foreground-secondary">
              {user.displayName}
            </div>
          )}

          {user.jobTitle && (
            <div className="mt-1 truncate text-xs text-foreground-secondary">
              {user.jobTitle}
            </div>
          )}

          {userGroups.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {userGroups.map((group) => {
                const style = getGroupBadgeStyle(group.name);
                return (
                  <span
                    key={group.id}
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ color: style.color, background: style.background }}
                  >
                    {group.name}
                  </span>
                );
              })}
            </div>
          )}

          {user.workEmail && (
            <div className="mt-2 truncate text-xs text-foreground-muted">
              {user.workEmail}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
