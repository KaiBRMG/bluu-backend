"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Loader } from "@/components/ui/loader";
import { useBasicUsers } from "@/hooks/useBasicUsers";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
import CreateNotificationDialog from "@/components/admin/notifications/CreateNotificationDialog";
import NotificationHistoryList from "@/components/admin/notifications/NotificationHistoryList";
import NotificationRecipientsDialog from "@/components/admin/notifications/NotificationRecipientsDialog";
import type { AdminNotificationBatch } from "@/types/firestore";

export default function AdminNotificationsPage() {
  const { users, groups, loading: usersLoading } = useBasicUsers();
  const { batches, loading: batchesLoading, refetch, createBatch, deleteBatch } = useAdminNotifications();
  const [selectedBatch, setSelectedBatch] = useState<AdminNotificationBatch | null>(null);

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Send System Notifications to Users</h1>

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

        <NotificationHistoryList
          batches={batches}
          loading={batchesLoading}
          onSelectBatch={setSelectedBatch}
        />

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
