'use client';

import { useMemo, useState } from 'react';
import { useActiveUsers } from '@/hooks/useActiveUsers';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { useUserData } from '@/hooks/useUserData';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Loader } from '@/components/ui/loader';

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
import type { ActiveSessionState } from '@/types/firestore';
import { RefreshCcw } from 'lucide-react';

const STATE_CONFIG: Record<ActiveSessionState, { color: string; label: string }> = {
  working:    { color: '#86C27E', label: 'Working' },
  idle:       { color: '#E37836', label: 'Idle' },
  'on-break': { color: '#4B8FCC', label: 'On Break' },
  paused:     { color: '#8B5CF6', label: 'Paused' },
};

function formatTime(date: Date, timezone?: string): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: timezone || undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function AdminActiveUsers() {
  const { activeSessions, isLoading: sessionsLoading } = useActiveUsers();
  const { users, groups, loading: usersLoading, refetch } = useAdminUsers();
  const { userData: viewerData } = useUserData();
  const viewerTimezone = viewerData?.timezone || 'UTC';
  const [selectedGroup, setSelectedGroup] = useState<string>('all');

  const userMap = useMemo(() => {
    const map = new Map<string, typeof users[number]>();
    for (const u of users) map.set(u.uid, u);
    return map;
  }, [users]);

  const filteredSessions = useMemo(() => {
    if (selectedGroup === 'all') return activeSessions;
    return activeSessions.filter(s => {
      const u = userMap.get(s.userId);
      return u?.groups?.includes(selectedGroup);
    });
  }, [activeSessions, selectedGroup, userMap]);

  const isLoading = sessionsLoading || usersLoading;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <select
            value={selectedGroup}
            onChange={e => setSelectedGroup(e.target.value)}
            className="form-input text-sm"
            style={{ minWidth: '160px' }}
          >
            <option value="all">All Groups</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            {filteredSessions.length} active
          </span>
        </div>

        <button
          onClick={refetch}
          className="p-1.5 rounded-md transition-colors hover:bg-white/10"
          title="Refresh"
        >
          <RefreshCcw width={16} height={16} />
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader />
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            No active users{selectedGroup !== 'all' ? ' in this group' : ''}.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredSessions.map(session => {
            const user = userMap.get(session.userId);
            const stateConfig = STATE_CONFIG[session.currentState];
            const displayName = user
              ? (`${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName)
              : session.userId;

            return (
              <div
                key={session.sessionId}
                className="flex items-center gap-4 px-4 py-3 rounded-lg"
                style={{
                  background: 'var(--background)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {/* Avatar */}
                <Avatar style={{ background: getAvatarColor(user?.displayName || 'User') }}>
                  {user?.photoURL && <AvatarImage src={user.photoURL} alt={user.displayName} />}
                  <AvatarFallback style={{ background: getAvatarColor(user?.displayName || 'User'), color: '#fff' }}>
                    {getInitials(user?.displayName || '')}
                  </AvatarFallback>
                </Avatar>

                {/* Name + clock-in time */}
                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm font-medium truncate"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {displayName}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                    Clock-in time: {formatTime(session.startTime, viewerTimezone)}
                  </div>
                </div>

                {/* State indicator */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: stateConfig.color,
                      boxShadow: session.currentState === 'working'
                        ? `0 0 6px ${stateConfig.color}`
                        : 'none',
                    }}
                  />
                  <span className="text-xs font-medium" style={{ color: stateConfig.color }}>
                    {stateConfig.label}
                  </span>
                </div>

                {/* Last activity */}
                <div
                  className="text-xs flex-shrink-0"
                  style={{ color: 'var(--foreground-muted)', minWidth: '130px', textAlign: 'right' }}
                >
                  Last activity at {formatTime(session.lastUpdated, viewerTimezone)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
