"use client";

import UserAvatar from '@/components/UserAvatar';
import type { AdminFullUser } from '@/hooks/useAdminUsers';

interface UserCardProps {
  user: AdminFullUser;
  onClick: () => void;
}

const EMPLOYMENT_BADGE_COLORS: Record<string, { color: string; bg: string }> = {
  'full-time': { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.08)' },
  'Full-time': { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.08)' },
  'part-time': { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)' },
  'Part-time': { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)' },
  'contractor': { color: '#f97316', bg: 'rgba(249, 115, 22, 0.08)' },
  'Contractor': { color: '#f97316', bg: 'rgba(249, 115, 22, 0.08)' },
  'intern': { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.08)' },
  'Intern': { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.08)' },
};

const DEFAULT_BADGE = { color: 'var(--foreground-muted)', bg: 'rgba(255, 255, 255, 0.04)' };

export default function UserCard({ user, onClick }: UserCardProps) {
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName;
  const badge = user.employmentType
    ? EMPLOYMENT_BADGE_COLORS[user.employmentType] || DEFAULT_BADGE
    : null;

  return (
    <div
      onClick={onClick}
      className="rounded-lg p-4 cursor-pointer transition-colors"
      style={{
        background: 'var(--sidebar-background)',
        border: '1px solid var(--border-subtle)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--hover-background)';
        e.currentTarget.style.borderColor = 'var(--foreground-muted)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--sidebar-background)';
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
      }}
    >
      <div className="flex items-start gap-3">
        <UserAvatar
          photoURL={user.photoURL}
          name={user.displayName || fullName}
          size="md"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
              {fullName}
            </span>
            {/* Active/inactive indicator */}
            <span className="flex items-center gap-1 flex-shrink-0">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background: user.isActive ? '#22c55e' : 'var(--foreground-muted)',
                }}
              />
              <span
                className="text-xs"
                style={{ color: user.isActive ? '#22c55e' : 'var(--foreground-muted)' }}
              >
                {user.isActive ? 'Active' : 'Away'}
              </span>
            </span>
          </div>

          {user.displayName && user.displayName !== fullName && (
            <div className="text-xs truncate" style={{ color: 'var(--foreground-secondary)' }}>
              {user.displayName}
            </div>
          )}

          {user.jobTitle && (
            <div className="text-xs mt-1 truncate" style={{ color: 'var(--foreground-secondary)' }}>
              {user.jobTitle}
            </div>
          )}

          <div className="flex items-center gap-2 mt-2">
            {badge && user.employmentType && (
              <span
                className="text-xs font-medium px-2 py-0.5 rounded"
                style={{ color: badge.color, background: badge.bg }}
              >
                {user.employmentType}
              </span>
            )}
          </div>

          {user.workEmail && (
            <div className="text-xs mt-2 truncate" style={{ color: 'var(--foreground-muted)' }}>
              {user.workEmail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
