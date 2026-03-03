"use client";

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { AdminFullUser } from '@/hooks/useAdminUsers';

const AVATAR_COLORS = [
  '#E57373', '#F06292', '#BA68C8', '#7986CB', '#64B5F6',
  '#4DD0E1', '#4DB6AC', '#81C784', '#FFB74D', '#A1887F',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function getAvatarColor(name: string): string {
  return AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  if (!name?.trim()) return '?';
  return name.split(' ').map((p) => p[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?';
}

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
      className="relative rounded-lg p-4 cursor-pointer transition-colors"
      style={{
        background: 'var(--container-background)',
        border: '1px solid var(--border-subtle)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--hover-background)';
        e.currentTarget.style.borderColor = 'var(--foreground-muted)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--container-background)';
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
      }}
    >
      <span
        className="absolute top-3 right-3 text-xs font-medium px-2 py-0.5 rounded flex items-center gap-1"
        style={{
          color: user.isActive !== false ? '#22c55e' : '#ef4444',
          background: user.isActive !== false ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
        }}
      >
        <span
          className="inline-block rounded-full"
          style={{ width: 6, height: 6, background: user.isActive !== false ? '#22c55e' : '#ef4444' }}
        />
        {user.isActive !== false ? 'Active' : 'Disabled'}
      </span>
      <div className="flex items-start gap-3">
        <Avatar style={{ background: getAvatarColor((user.displayName || fullName) || 'User') }}>
          {user.photoURL && <AvatarImage src={user.photoURL} alt={user.displayName || fullName} />}
          <AvatarFallback style={{ background: getAvatarColor((user.displayName || fullName) || 'User'), color: '#fff' }}>
            {getInitials(user.displayName || fullName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
              {fullName}
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
