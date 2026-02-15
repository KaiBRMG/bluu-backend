"use client";

import { useState } from 'react';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import UserAvatar from '@/components/UserAvatar';
import AddMembersDropdown from './AddMembersDropdown';

interface GroupMemberListProps {
  group: AdminGroup;
  allUsers: AdminFullUser[];
  onRemoveMember: (groupId: string, uid: string) => Promise<void>;
  onAddMembers: (groupId: string, uids: string[]) => Promise<void>;
}

export default function GroupMemberList({
  group,
  allUsers,
  onRemoveMember,
  onAddMembers,
}: GroupMemberListProps) {
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [removingUid, setRemovingUid] = useState<string | null>(null);

  // Resolve member UIDs to user objects
  const members = (group.members || [])
    .map((uid) => allUsers.find((u) => u.uid === uid))
    .filter(Boolean) as AdminFullUser[];

  const handleRemove = async (uid: string) => {
    setRemovingUid(uid);
    try {
      await onRemoveMember(group.id, uid);
    } catch (err) {
      console.error('Failed to remove member:', err);
    } finally {
      setRemovingUid(null);
    }
  };

  const handleAddMembers = async (uids: string[]) => {
    try {
      await onAddMembers(group.id, uids);
    } catch (err) {
      console.error('Failed to add members:', err);
    }
  };

  return (
    <div className="flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
            {group.name}
          </h3>
          <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
            {members.length} member{members.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowAddDropdown(!showAddDropdown)}
            className="btn-primary text-sm"
          >
            Add Members
          </button>
          {showAddDropdown && (
            <AddMembersDropdown
              group={group}
              allUsers={allUsers}
              onAdd={handleAddMembers}
              onClose={() => setShowAddDropdown(false)}
            />
          )}
        </div>
      </div>

      {/* Members list */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--border-subtle)' }}
      >
        {members.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
            No members in this group.
          </div>
        ) : (
          members.map((member) => (
            <div
              key={member.uid}
              className="flex items-center gap-3 px-3 py-2 text-sm"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <UserAvatar
                photoURL={member.photoURL}
                name={member.displayName}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <span className="block truncate" style={{ color: 'var(--foreground)' }}>
                  {member.displayName}
                </span>
                {member.jobTitle && (
                  <span className="block text-xs truncate" style={{ color: 'var(--foreground-muted)' }}>
                    {member.jobTitle}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleRemove(member.uid)}
                disabled={removingUid === member.uid}
                className="p-1 rounded transition-colors flex-shrink-0"
                style={{
                  color: removingUid === member.uid ? 'var(--foreground-muted)' : 'var(--foreground-secondary)',
                }}
                onMouseEnter={(e) => {
                  if (removingUid !== member.uid) {
                    e.currentTarget.style.background = 'var(--hover-background)';
                    e.currentTarget.style.color = '#ef4444';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--foreground-secondary)';
                }}
                title="Remove from group"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
