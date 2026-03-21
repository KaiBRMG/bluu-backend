"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import AppLayout from "@/components/AppLayout";
import AdminShifts from "@/components/admin/shift-management/AdminShifts";

const AdminActiveUsers = dynamic(
  () => import("@/components/admin/shift-management/AdminActiveUsers"),
  { loading: () => <div style={{ minHeight: 400 }} /> }
);
const AdminTimesheets = dynamic(
  () => import("@/components/admin/shift-management/AdminTimesheets"),
  { loading: () => <div style={{ minHeight: 400 }} /> }
);
const AdminScreenshots = dynamic(
  () => import("@/components/admin/shift-management/AdminScreenshots"),
  { loading: () => <div style={{ minHeight: 400 }} /> }
);
const AdminLeave = dynamic(
  () => import("@/components/admin/shift-management/AdminLeave"),
  { loading: () => <div style={{ minHeight: 400 }} /> }
);
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function ShiftManagementPage() {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Shift Management
        </h1>
        <p className="text-sm text-muted-foreground">
          View and manage employee time tracking.
        </p>

        <div
          className="mt-8 rounded-lg"
          style={{
            background: 'var(--sidebar-background)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <Tabs defaultValue="shifts">
            <div className="px-6 pt-4">
              <TabsList>
                <TabsTrigger value="shifts">Shifts</TabsTrigger>
                <TabsTrigger value="active-users">Active Users</TabsTrigger>
                <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
                <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
                <TabsTrigger value="leave">Leave</TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6" style={{ minHeight: '600px' }}>
              <TabsContent value="shifts"><AdminShifts /></TabsContent>
              <TabsContent value="active-users"><AdminActiveUsers /></TabsContent>
              <TabsContent value="timesheets">
                <AdminTimesheets selectedUserId={selectedUserId} onUserChange={setSelectedUserId} />
              </TabsContent>
              <TabsContent value="screenshots">
                <AdminScreenshots selectedUserId={selectedUserId} onUserChange={setSelectedUserId} />
              </TabsContent>
              <TabsContent value="leave"><AdminLeave /></TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
