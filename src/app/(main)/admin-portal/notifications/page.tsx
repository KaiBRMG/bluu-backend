"use client";

import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Loader } from "@/components/ui/loader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBasicUsers } from "@/hooks/useBasicUsers";
import { useCreatorRecipients } from "@/hooks/useCreatorRecipients";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
import CreateNotificationDialog from "@/components/admin/notifications/CreateNotificationDialog";
import NotificationHistoryList from "@/components/admin/notifications/NotificationHistoryList";
import NotificationRecipientsDialog from "@/components/admin/notifications/NotificationRecipientsDialog";
import AutomatedNotificationsList from "@/components/admin/notifications/AutomatedNotificationsList";
import NotificationLogsList from "@/components/admin/notifications/NotificationLogsList";
import { AUTOMATED_NOTIFICATIONS, AUTOMATED_CREATOR_NOTIFICATIONS } from "@/lib/automatedNotifications";
import type { AdminNotificationBatch } from "@/types/firestore";

export default function AdminNotificationsPage() {
  const { users, groups, loading: usersLoading } = useBasicUsers();
  const { creators, loading: creatorsLoading } = useCreatorRecipients();
  const { batches, loading: batchesLoading, refetch, createBatch, deleteBatch } = useAdminNotifications();
  const [selectedBatch, setSelectedBatch] = useState<AdminNotificationBatch | null>(null);
  // Tabs are controlled only so the shell can widen for the Logs ledger: six
  // columns do not fit the reading measure the other two tabs are sized to.
  const [tab, setTab] = useState("sent");

  return (
    <AppLayout>
      <div className={tab === "logs" ? "max-w-7xl" : "max-w-5xl"}>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight">System Notifications</h1>

          {usersLoading || creatorsLoading ? (
            <Loader />
          ) : (
            <CreateNotificationDialog
              users={users}
              groups={groups}
              creators={creators}
              onCreated={refetch}
              onCreate={createBatch}
            />
          )}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="sent">One-Time Notifications</TabsTrigger>
            <TabsTrigger value="automated">
              Automated
              <span className="text-xs text-zinc-400 tabular-nums">
                {AUTOMATED_NOTIFICATIONS.length + AUTOMATED_CREATOR_NOTIFICATIONS.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
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

          {/*
            The delivery log is one row per `notifications` document — what was
            sent, to whom, and whether they opened it — across both the manual
            and the automated paths. Mounted lazily by `Tabs`, so an admin who
            never opens it pays nothing.
          */}
          <TabsContent value="logs">
            <NotificationLogsList />
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
