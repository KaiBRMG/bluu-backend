"use client";

import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import EmployeeRegistry from "@/components/admin/user-management/EmployeeRegistry";
import UserGroups from "@/components/admin/user-management/UserGroups";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader } from "@/components/ui/loader";

export default function UserManagementPage() {
  const [activeSection, setActiveSection] = useState("employee-registry");
  const { users, groups, loading, error, refetch, updateUser, addGroupMembers, removeGroupMember, deleteUser } =
    useAdminUsers();

  const { activeCount, archivedCount } = useMemo(() => {
    let active = 0;
    let archived = 0;
    for (const u of users) {
      if (u.isArchived) archived += 1;
      else active += 1;
    }
    return { activeCount: active, archivedCount: archived };
  }, [users]);

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
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
          <AlertCircle className="size-8" style={{ color: "#ef4444" }} />
          <div>
            <div className="text-sm font-medium">Couldn&apos;t load user management</div>
            <div className="mt-1 text-sm text-foreground-muted">{error}</div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="dark max-w-6xl">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            See and manage employee data and user groups.
          </p>
        </header>

        <Tabs value={activeSection} onValueChange={setActiveSection}>
          <TabsList className="mb-6">
            <TabsTrigger value="employee-registry">
              Employee Registry
              <TabCount value={activeCount} />
            </TabsTrigger>
            <TabsTrigger value="user-groups">
              User Groups
              <TabCount value={groups.length} />
            </TabsTrigger>
            <TabsTrigger value="archived-users">
              Archived Users
              <TabCount value={archivedCount} />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="employee-registry">
            <EmployeeRegistry
              users={users}
              groups={groups}
              onUpdateUser={updateUser}
              onAddGroupMembers={addGroupMembers}
              onRemoveGroupMember={removeGroupMember}
              onRefetch={refetch}
              onDeleteUser={deleteUser}
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
          <TabsContent value="archived-users">
            <EmployeeRegistry
              users={users}
              groups={groups}
              onUpdateUser={updateUser}
              onAddGroupMembers={addGroupMembers}
              onRemoveGroupMember={removeGroupMember}
              onRefetch={refetch}
              onDeleteUser={deleteUser}
              showArchived
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function TabCount({ value }: { value: number }) {
  return (
    <span className="ml-1 rounded-full bg-white/10 px-1.5 text-[11px] font-medium text-foreground-secondary tabular-nums">
      {value}
    </span>
  );
}
