"use client";

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import { getGroupBadgeStyle } from './groupColors';
import { isInvitedUser, invitedStageLabel } from './userStatus';

import { getAvatarColor, getInitials } from '@/lib/utils/avatar';

interface UserCardProps {
  user: AdminFullUser;
  groups: AdminGroup[];
  onClick: () => void;
}

export default function UserCard({ user, groups, onClick }: UserCardProps) {
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName;
  const isActive = user.isActive !== false;
  // Registered but not yet set up — see isInvitedUser for why this runs until
  // onboarding completes, not just until first login. Shown instead of
  // Active/Disabled because it is the more useful fact: nothing about this
  // account has been confirmed yet, and a mistyped login email surfaces as an
  // invite that never turns into a login. Orange = awaiting, per the palette.
  const isInvited = isInvitedUser(user);
  const status = isInvited
    ? { label: 'Invited', color: '#fb923c', tint: 'rgba(251,146,60,0.10)' }
    : isActive
      ? { label: 'Active', color: '#22c55e', tint: 'rgba(34,197,94,0.10)' }
      : { label: 'Disabled', color: '#ef4444', tint: 'rgba(239,68,68,0.10)' };
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
        style={{ color: status.color, background: status.tint }}
      >
        <span
          className="inline-block size-1.5 rounded-full"
          style={{ background: status.color }}
        />
        {status.label}
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

          {/* The badge says "not set up"; this says how far they got, which is
              what decides whether to chase the person or check the email. */}
          {isInvited && (
            <div className="mt-1 truncate text-xs" style={{ color: '#fb923c' }}>
              {invitedStageLabel(user)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
