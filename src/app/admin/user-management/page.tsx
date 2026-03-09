"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import EmployeeRegistry from "@/components/admin/user-management/EmployeeRegistry";
import UserGroups from "@/components/admin/user-management/UserGroups";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader } from "@/components/ui/loader";

export default function UserManagementPage() {
  const [activeSection, setActiveSection] = useState('employee-registry');
  const { users, groups, loading, error, refetch, updateUser, addGroupMembers, removeGroupMember } =
    useAdminUsers();

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader />
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

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          User Management
        </h1>
        <p className="text-sm text-muted-foreground">
          See and manage employee data and user groups.
        </p>

        <div
          className="mt-8 rounded-lg"
          style={{
            background: 'var(--sidebar-background)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <Tabs
            value={activeSection}
            onValueChange={setActiveSection}
          >
            <div className="px-6 pt-4">
              <TabsList>
                <TabsTrigger value="employee-registry">Employee Registry</TabsTrigger>
                <TabsTrigger value="user-groups">User Groups</TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6" style={{ minHeight: '600px' }}>
              <TabsContent value="employee-registry">
                <EmployeeRegistry
                  users={users}
                  groups={groups}
                  onUpdateUser={updateUser}
                  onAddGroupMembers={addGroupMembers}
                  onRemoveGroupMember={removeGroupMember}
                  onRefetch={refetch}
                />
              </TabsContent>
              <TabsContent value="user-groups">
                <UserGroups
                  users={users}
                  groups={groups}
                  onAddGroupMembers={addGroupMembers}
                  onRemoveGroupMember={removeGroupMember}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
