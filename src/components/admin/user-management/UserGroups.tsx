"use client";

import { useState } from 'react';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import GroupList from './GroupList';
import GroupMemberList from './GroupMemberList';

interface UserGroupsProps {
  users: AdminFullUser[];
  groups: AdminGroup[];
  onAddGroupMembers: (groupId: string, uids: string[]) => Promise<void>;
  onRemoveGroupMember: (groupId: string, uid: string) => Promise<void>;
}

export default function UserGroups({
  users,
  groups,
  onAddGroupMembers,
  onRemoveGroupMember,
}: UserGroupsProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    groups.length > 0 ? groups[0].id : null
  );

  const selectedGroup = selectedGroupId
    ? groups.find((g) => g.id === selectedGroupId) ?? null
    : null;

  return (
    <div className="flex min-h-[500px] gap-4">
      <GroupList
        groups={groups}
        selectedGroupId={selectedGroupId}
        onSelectGroup={setSelectedGroupId}
      />

      {selectedGroup ? (
        <GroupMemberList
          key={selectedGroup.id}
          group={selectedGroup}
          allUsers={users}
          onRemoveMember={onRemoveGroupMember}
          onAddMembers={onAddGroupMembers}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-foreground-muted">
            Select a group to view its members.
          </p>
        </div>
      )}
    </div>
  );
}
