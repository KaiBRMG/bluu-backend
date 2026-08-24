"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Loader } from "@/components/ui/loader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBasicUsers } from "@/hooks/useBasicUsers";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
import CreateNotificationDialog from "@/components/admin/notifications/CreateNotificationDialog";
import NotificationHistoryList from "@/components/admin/notifications/NotificationHistoryList";
import NotificationRecipientsDialog from "@/components/admin/notifications/NotificationRecipientsDialog";
import AutomatedNotificationsList from "@/components/admin/notifications/AutomatedNotificationsList";
import { AUTOMATED_NOTIFICATIONS } from "@/lib/automatedNotifications";
import type { AdminNotificationBatch } from "@/types/firestore";

export default function AdminNotificationsPage() {
  const { users, groups, loading: usersLoading } = useBasicUsers();
  const { batches, loading: batchesLoading, refetch, createBatch, deleteBatch } = useAdminNotifications();
  const [selectedBatch, setSelectedBatch] = useState<AdminNotificationBatch | null>(null);

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight">System Notifications</h1>

          {usersLoading ? (
            <Loader />
          ) : (
            <CreateNotificationDialog
              users={users}
              groups={groups}
              onCreated={refetch}
              onCreate={createBatch}
            />
          )}
        </div>

        <Tabs defaultValue="sent">
          <TabsList>
            <TabsTrigger value="sent">Sent</TabsTrigger>
            <TabsTrigger value="automated">
              Automated
              <span className="text-xs text-zinc-400 tabular-nums">
                {AUTOMATED_NOTIFICATIONS.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sent">
            <NotificationHistoryList
              batches={batches}
              loading={batchesLoading}
              onSelectBatch={setSelectedBatch}
            />
          </TabsContent>

          <TabsContent value="automated">
            <AutomatedNotificationsList />
          </TabsContent>
        </Tabs>

        <NotificationRecipientsDialog
          batch={selectedBatch}
          open={selectedBatch !== null}
          onClose={() => setSelectedBatch(null)}
          onDelete={deleteBatch}
        />
      </div>
    </AppLayout>
  );
}
