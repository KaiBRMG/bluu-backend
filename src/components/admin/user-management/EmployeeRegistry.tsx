"use client";

import { useState, useMemo, useCallback } from 'react';
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
  onDeleteUser: (uid: string) => Promise<void>;
  showArchived?: boolean;
}

export default function EmployeeRegistry({
  users,
  groups,
  onUpdateUser,
  onAddGroupMembers,
  onRemoveGroupMember,
  onRefetch,
  onDeleteUser,
  showArchived = false,
}: EmployeeRegistryProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('');

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users
      .filter((u) => {
        if (showArchived ? !u.isArchived : u.isArchived) return false;
        if (groupFilter && !u.groups?.includes(groupFilter)) return false;
        if (statusFilter === 'active' && !u.isActive) return false;
        if (statusFilter === 'inactive' && u.isActive) return false;
        if (employmentTypeFilter && u.employmentType !== employmentTypeFilter) return false;
        if (q) {
          const first = (u.firstName || '').toLowerCase();
          const last = (u.lastName || '').toLowerCase();
          const display = (u.displayName || '').toLowerCase();
          if (!first.includes(q) && !last.includes(q) && !display.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aFirst = (a.firstName || '').toLowerCase();
        const aLast = (a.lastName || '').toLowerCase();
        const bFirst = (b.firstName || '').toLowerCase();
        const bLast = (b.lastName || '').toLowerCase();
        if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
        return aLast.localeCompare(bLast);
      });
  }, [users, searchQuery, groupFilter, statusFilter, employmentTypeFilter, showArchived]);

  const handleDeleteUser = useCallback(async () => {
    if (!selectedUserId) return;
    await onDeleteUser(selectedUserId);
    setSelectedUserId(null);
  }, [selectedUserId, onDeleteUser]);

  return (
    <div>
      <RegistryFilters
        groups={groups}
        groupFilter={groupFilter}
        statusFilter={statusFilter}
        employmentTypeFilter={employmentTypeFilter}
        searchQuery={searchQuery}
        onGroupFilterChange={setGroupFilter}
        onStatusFilterChange={setStatusFilter}
        onEmploymentTypeFilterChange={setEmploymentTypeFilter}
        onSearchQueryChange={setSearchQuery}
      />

      {filteredUsers.length === 0 ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            {showArchived ? 'No archived users.' : 'No users found matching the selected filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredUsers.map((user) => (
            <UserCard
              key={user.uid}
              user={user}
              groups={groups}
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
        onDeleteUser={handleDeleteUser}
      />
    </div>
  );
}
