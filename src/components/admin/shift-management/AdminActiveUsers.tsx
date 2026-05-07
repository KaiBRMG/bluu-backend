'use client';

import { useMemo, useState } from 'react';
import { useActiveUsers } from '@/hooks/useActiveUsers';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import { useUserData } from '@/hooks/useUserData';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Loader } from '@/components/ui/loader';
import { Progress } from '@/components/ui/progress';
import { ChevronDownIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
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
  const { users, groups, loading: usersLoading, refetch } = useBasicUsers();
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="form-input text-sm flex items-center justify-between gap-2"
                style={{ cursor: 'pointer', minWidth: '160px' }}
              >
                <span>{selectedGroup === 'all' ? 'All Groups' : (groups.find(g => g.id === selectedGroup)?.name ?? 'All Groups')}</span>
                <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="dark min-w-[160px]">
              <DropdownMenuItem onSelect={() => setSelectedGroup('all')}>All Groups</DropdownMenuItem>
              {groups.map(g => (
                <DropdownMenuItem key={g.id} onSelect={() => setSelectedGroup(g.id)}>{g.name}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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

                {/* Activity % */}
                <div className="flex items-center gap-1.5 flex-shrink-0" style={{ minWidth: '110px' }}>
                  <Progress value={session.lastActivityPercent ?? 100} className="flex-1 h-1.5" />
                  <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    {session.lastActivityPercent ?? 100}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
