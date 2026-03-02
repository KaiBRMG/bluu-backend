"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import AdminTimesheets from "@/components/admin/shift-management/AdminTimesheets";
import AdminScreenshots from "@/components/admin/shift-management/AdminScreenshots";
import AdminActiveUsers from "@/components/admin/shift-management/AdminActiveUsers";
import AdminShifts from "@/components/admin/shift-management/AdminShifts";
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
              <TabsList variant="line">
                <TabsTrigger value="shifts">Shifts</TabsTrigger>
                <TabsTrigger value="active-users">Active Users</TabsTrigger>
                <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
                <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
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
            </div>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
