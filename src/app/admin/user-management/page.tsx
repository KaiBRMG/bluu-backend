"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import UserManagementSidebar from "@/components/admin/user-management/UserManagementSidebar";
import EmployeeRegistry from "@/components/admin/user-management/EmployeeRegistry";
import UserGroups from "@/components/admin/user-management/UserGroups";

export default function UserManagementPage() {
  const [activeSection, setActiveSection] = useState('employee-registry');
  const { users, groups, loading, error, refetch, updateUser, addGroupMembers, removeGroupMember } =
    useAdminUsers();

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div style={{ color: "var(--foreground-muted)" }}>Loading user management...</div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-red-400 mb-2">Error loading user management</div>
            <div className="text-sm" style={{ color: "var(--foreground-muted)" }}>
              {error}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'employee-registry':
        return (
          <EmployeeRegistry
            users={users}
            groups={groups}
            onUpdateUser={updateUser}
            onAddGroupMembers={addGroupMembers}
            onRemoveGroupMember={removeGroupMember}
            onRefetch={refetch}
          />
        );
      case 'user-groups':
        return (
          <UserGroups
            users={users}
            groups={groups}
            onAddGroupMembers={addGroupMembers}
            onRemoveGroupMember={removeGroupMember}
          />
        );
      default:
        return null;
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <h1 className="text-5xl font-bold mb-2 tracking-tight">
          User Management
        </h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Manage employees and user groups.
        </p>

        <div className="mt-8 flex gap-6">
          <UserManagementSidebar
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />

          <div
            className="flex-1 rounded-lg p-6"
            style={{
              background: 'var(--sidebar-background)',
              border: '1px solid var(--border-subtle)',
              minHeight: '600px',
            }}
          >
            {renderContent()}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
