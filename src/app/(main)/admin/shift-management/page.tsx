"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import AppLayout from "@/components/AppLayout";
import AdminShifts from "@/components/admin/shift-management/AdminShifts";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// Shaped loader for lazily-loaded tab panels — a header row + a table body,
// sized to fill the content wrapper so switching tabs doesn't flash or shift.
function PanelSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>
      <Skeleton className="h-[520px] w-full rounded-xl" />
    </div>
  );
}

const AdminActiveUsers = dynamic(
  () => import("@/components/admin/shift-management/AdminActiveUsers"),
  { loading: () => <PanelSkeleton /> }
);
const AdminTimesheets = dynamic(
  () => import("@/components/admin/shift-management/AdminTimesheets"),
  { loading: () => <PanelSkeleton /> }
);
const AdminScreenshots = dynamic(
  () => import("@/components/admin/shift-management/AdminScreenshots"),
  { loading: () => <PanelSkeleton /> }
);
const AdminLeave = dynamic(
  () => import("@/components/admin/shift-management/AdminLeave"),
  { loading: () => <PanelSkeleton /> }
);
const AdminAnalytics = dynamic(
  () => import("@/components/admin/shift-management/analytics/AdminAnalytics"),
  { loading: () => <PanelSkeleton /> }
);

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

        <div className="mt-8 rounded-lg bg-content-bg border border-border-subtle">
          <Tabs defaultValue="shifts">
            {/* pb-1.5: overflow-x:auto forces overflow-y to auto, so reserve room
                for the trigger focus ring instead of letting it clip. */}
            <div className="px-6 pt-4 pb-1.5 overflow-x-auto">
              <TabsList>
                <TabsTrigger value="shifts">Shifts</TabsTrigger>
                <TabsTrigger value="active-users">Active Users</TabsTrigger>
                <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
                <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
                <TabsTrigger value="leave">Leave</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6 min-h-[600px]">
              <TabsContent value="shifts"><AdminShifts /></TabsContent>
              <TabsContent value="active-users"><AdminActiveUsers /></TabsContent>
              <TabsContent value="timesheets">
                <AdminTimesheets selectedUserId={selectedUserId} onUserChange={setSelectedUserId} />
              </TabsContent>
              <TabsContent value="screenshots">
                <AdminScreenshots selectedUserId={selectedUserId} onUserChange={setSelectedUserId} />
              </TabsContent>
              <TabsContent value="leave"><AdminLeave /></TabsContent>
              <TabsContent value="analytics">
                <AdminAnalytics selectedUserId={selectedUserId} onUserChange={setSelectedUserId} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
