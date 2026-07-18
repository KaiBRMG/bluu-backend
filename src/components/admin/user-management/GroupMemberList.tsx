"use client";

import { useState } from 'react';
import { X } from 'lucide-react';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from "@/components/ui/button";

import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import AddMembersDropdown from './AddMembersDropdown';
import { getGroupColor } from './groupColors';

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

  const groupColor = getGroupColor(group.name);

  return (
    <div className="flex-1 min-w-0">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span
              className="inline-block size-2 flex-shrink-0 rounded-full"
              style={{ background: groupColor }}
            />
            {group.name}
          </h3>
          <span className="text-xs text-foreground-muted">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="relative">
          <Button onClick={() => setShowAddDropdown(!showAddDropdown)} size="sm">
            Add Members
          </Button>
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
      <div className="overflow-hidden rounded-lg border border-border-subtle">
        {members.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-foreground-muted">
            No members in this group.
          </div>
        ) : (
          members.map((member) => (
            <div
              key={member.uid}
              className="flex items-center gap-3 border-b px-3 py-2 text-sm transition-colors border-border-subtle hover:bg-hover-bg last:border-b-0"
            >
              <Avatar className="size-7" style={{ background: getAvatarColor(member.displayName || 'User') }}>
                {member.photoURL && <AvatarImage src={member.photoURL} alt={member.displayName} />}
                <AvatarFallback style={{ background: getAvatarColor(member.displayName || 'User'), color: '#fff' }}>
                  {getInitials(member.displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <span className="block truncate text-foreground">
                  {member.displayName}
                </span>
                {member.jobTitle && (
                  <span className="block truncate text-xs text-foreground-muted">
                    {member.jobTitle}
                  </span>
                )}
              </div>
              {group.id !== 'unassigned' && (
                <Button
                  onClick={() => handleRemove(member.uid)}
                  disabled={removingUid === member.uid}
                  variant="ghost"
                  size="icon"
                  className="size-7 flex-shrink-0 text-foreground-secondary"
                  title="Remove from group"
                >
                  <X />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
