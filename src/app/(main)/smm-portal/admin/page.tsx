'use client';

import { useRef, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AccountDatabaseTab } from '@/components/smm/admin/AccountDatabaseTab';
import { ContentScheduleTab } from '@/components/smm/admin/ContentScheduleTab';
import { BonusManagementTab } from '@/components/smm/admin/BonusManagementTab';
import { UnsavedChangesDialog } from '@/components/smm/shared/UnsavedChangesDialog';

export default function SmmAdminPage() {
  const [tab, setTab] = useState('accounts');
  // Account Database staged-edit guard: block a tab switch while edits are unsaved.
  const [accountsDirty, setAccountsDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef<(() => Promise<void>) | null>(null);

  const requestTab = (next: string) => {
    if (next === tab) return;
    if (tab === 'accounts' && accountsDirty) { setPendingTab(next); return; }
    setTab(next);
  };

  const proceedDiscard = () => {
    const next = pendingTab;
    setPendingTab(null);
    if (next) setTab(next); // switching unmounts the tab, dropping its staged edits
  };

  const proceedSave = async () => {
    setSaving(true);
    try {
      await saveRef.current?.();
    } catch {
      return; // save failed (toast shown by the tab) — stay put, keep the dialog open
    } finally {
      setSaving(false);
    }
    const next = pendingTab;
    setPendingTab(null);
    if (next) setTab(next);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl">
        <Tabs value={tab} onValueChange={requestTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="accounts">Account Database</TabsTrigger>
            <TabsTrigger value="schedule">Content Schedule</TabsTrigger>
            <TabsTrigger value="bonus">Bonus Management</TabsTrigger>
          </TabsList>

          <TabsContent value="accounts">
            <h1 className="text-2xl font-bold tracking-tight mb-4">Account Database</h1>
            <AccountDatabaseTab onDirtyChange={setAccountsDirty} saveRef={saveRef} />
          </TabsContent>

          <TabsContent value="schedule">
            <ContentScheduleTab />
          </TabsContent>

          <TabsContent value="bonus">
            <BonusManagementTab />
          </TabsContent>
        </Tabs>
      </div>

      <UnsavedChangesDialog
        open={pendingTab !== null}
        saving={saving}
        onCancel={() => setPendingTab(null)}
        onDiscard={proceedDiscard}
        onSave={proceedSave}
      />
    </AppLayout>
  );
}
