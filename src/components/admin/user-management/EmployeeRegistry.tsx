"use client";

import { useState, useMemo } from 'react';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import RegistryFilters from './RegistryFilters';
import UserCard from './UserCard';
import UserDetailDrawer from './UserDetailDrawer';

interface EmployeeRegistryProps {
  users: AdminFullUser[];
  groups: AdminGroup[];
  onUpdateUser: (uid: string, updates: Record<string, unknown>) => Promise<void>;
  onAddGroupMembers: (groupId: string, uids: string[]) => Promise<void>;
  onRemoveGroupMember: (groupId: string, uid: string) => Promise<void>;
  onRefetch: () => Promise<void>;
}

export default function EmployeeRegistry({
  users,
  groups,
  onUpdateUser,
  onAddGroupMembers,
  onRemoveGroupMember,
  onRefetch,
}: EmployeeRegistryProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('');

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (groupFilter && !u.groups?.includes(groupFilter)) return false;
      if (statusFilter === 'active' && !u.isActive) return false;
      if (statusFilter === 'inactive' && u.isActive) return false;
      if (employmentTypeFilter && u.employmentType !== employmentTypeFilter) return false;
      return true;
    });
  }, [users, groupFilter, statusFilter, employmentTypeFilter]);

  const selectedUser = selectedUserId
    ? users.find((u) => u.uid === selectedUserId) ?? null
    : null;

  return (
    <div>
      <RegistryFilters
        groups={groups}
        groupFilter={groupFilter}
        statusFilter={statusFilter}
        employmentTypeFilter={employmentTypeFilter}
        onGroupFilterChange={setGroupFilter}
        onStatusFilterChange={setStatusFilter}
        onEmploymentTypeFilterChange={setEmploymentTypeFilter}
      />

      {filteredUsers.length === 0 ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            No users found matching the selected filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredUsers.map((user) => (
            <UserCard
              key={user.uid}
              user={user}
              onClick={() => setSelectedUserId(user.uid)}
            />
          ))}
        </div>
      )}

      <UserDetailDrawer
        userId={selectedUserId}
        users={users}
        groups={groups}
        onClose={() => setSelectedUserId(null)}
        onUpdateUser={onUpdateUser}
        onAddGroupMembers={onAddGroupMembers}
        onRemoveGroupMember={onRemoveGroupMember}
        onRefetch={onRefetch}
      />
    </div>
  );
}
