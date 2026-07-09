'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AccountsDatabaseTable } from '@/components/smm/admin/AccountsDatabaseTable';
import { AddAccountDialog } from '@/components/smm/admin/AddAccountDialog';
import { AccountDialog } from '@/components/smm/shared/AccountDialog';
import { useSmmAccountDatabase, useSmmAccounts, type SmmAccountPayload } from '@/hooks/useSmmAccounts';
import { useSmmUsers } from '@/hooks/useSmmUsers';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { SmmAccount } from '@/types/firestore';

/**
 * Searchable, inline-editable database of every Twitter/X account. Inline field
 * edits are staged locally and only written when the user clicks Save — the
 * parent page guards navigation while edits are unsaved (see {@link saveRef}).
 * Accounts load one network group at a time — see {@link useSmmAccountDatabase}.
 */
export function AccountDatabaseTab({
  onDirtyChange,
  saveRef,
}: {
  onDirtyChange: (dirty: boolean) => void;
  saveRef: React.MutableRefObject<(() => Promise<void>) | null>;
}) {
  const { groupFor, loadNetwork, createAccount, updateAccount, saveAccounts, deleteAccount } = useSmmAccountDatabase();
  const { users } = useSmmUsers();
  // Slim active-account list for the post-move dropdown in the Content tab.
  const { accounts: activeAccounts } = useSmmAccounts('active');

  const [search, setSearch] = useState('');
  // Filtering + lazy-loading run off the debounced value so keystrokes stay
  // smooth; the input itself stays fully responsive on `search`.
  const debouncedSearch = useDebouncedValue(search, 300);
  const [addOpen, setAddOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<SmmAccount | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // Staged (unsaved) inline edits, keyed by account id.
  const [pendingEdits, setPendingEdits] = useState<Record<string, Partial<SmmAccountPayload>>>({});
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(pendingEdits).length > 0;

  const onStage = useCallback((id: string, updates: Partial<SmmAccountPayload>) => {
    setPendingEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...updates } }));
  }, []);

  const handleSave = useCallback(async () => {
    if (Object.keys(pendingEdits).length === 0) return;
    setSaving(true);
    try {
      await saveAccounts(pendingEdits);
      setPendingEdits({});
      toast.success('Changes saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save changes');
      throw err; // let the navigation guard keep the user on this tab
    } finally {
      setSaving(false);
    }
  }, [pendingEdits, saveAccounts]);

  // Keep the parent's navigation guard in sync with this tab's dirty state + save.
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  // On unmount (e.g. discarding edits by switching tabs), the staged edits are
  // gone — clear the parent's dirty flag so it doesn't stay stale.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    saveRef.current = handleSave;
    return () => { saveRef.current = null; };
  }, [handleSave, saveRef]);

  // Warn on full-page navigation / reload / close while edits are unsaved.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Stable identity so the memoized table doesn't re-render while typing.
  const handleEdit = useCallback((account: SmmAccount) => {
    setEditAccount(account);
    setEditOpen(true);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search account names, profile links, SMMs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button variant="outline" onClick={() => handleSave().catch(() => {})} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon className="size-4" />
            Add Account
          </Button>
        </div>
      </div>

      <AccountsDatabaseTable
        groupFor={groupFor}
        loadNetwork={loadNetwork}
        users={users}
        search={debouncedSearch}
        pendingEdits={pendingEdits}
        onStage={onStage}
        onEdit={handleEdit}
        onDelete={deleteAccount}
      />

      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        users={users}
        onCreate={createAccount}
      />

      <AccountDialog
        account={editAccount}
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        users={users}
        onSave={updateAccount}
        postEditAccounts={activeAccounts}
      />
    </div>
  );
}
