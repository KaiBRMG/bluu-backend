"use client";

import { useEffect, useState } from 'react';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import UserDetailContent from './UserDetailContent';

interface UserDetailDrawerProps {
  userId: string | null;
  users: AdminFullUser[];
  groups: AdminGroup[];
  onClose: () => void;
  onUpdateUser: (uid: string, updates: Record<string, unknown>) => Promise<void>;
  onAddGroupMembers: (groupId: string, uids: string[]) => Promise<void>;
  onRemoveGroupMember: (groupId: string, uid: string) => Promise<void>;
  onRefetch: () => Promise<void>;
}

export default function UserDetailDrawer({
  userId,
  users,
  groups,
  onClose,
  onUpdateUser,
  onAddGroupMembers,
  onRemoveGroupMember,
  onRefetch,
}: UserDetailDrawerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const user = userId ? users.find((u) => u.uid === userId) ?? null : null;

  // Handle open/close animation
  useEffect(() => {
    if (userId) {
      setIsVisible(true);
      // Trigger animation on next frame
      requestAnimationFrame(() => setIsAnimating(true));
    } else {
      setIsAnimating(false);
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [userId]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          background: 'rgba(0, 0, 0, 0.3)',
          opacity: isAnimating ? 1 : 0,
        }}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className="absolute top-0 right-0 bottom-0 w-[500px] overflow-y-auto transition-transform duration-300 ease-in-out"
        style={{
          background: 'var(--background)',
          borderLeft: '1px solid var(--border-subtle)',
          transform: isAnimating ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
          style={{
            background: 'var(--background)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
            {user
              ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName
              : 'User Details'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--foreground-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--hover-background)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content — key forces remount when switching users */}
        {user && (
          <UserDetailContent
            key={user.uid}
            user={user}
            groups={groups}
            onUpdateUser={onUpdateUser}
            onAddGroupMembers={onAddGroupMembers}
            onRemoveGroupMember={onRemoveGroupMember}
            onRefetch={onRefetch}
          />
        )}
      </div>
    </div>
  );
}
