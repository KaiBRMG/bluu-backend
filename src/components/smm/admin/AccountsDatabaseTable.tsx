'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon, EllipsisIcon, Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/smm/shared/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MultiSelect } from '@/components/smm/shared/MultiSelect';
import { NetworkBadge } from '@/components/smm/shared/badges';
import { cn } from '@/lib/utils';
import { SMM_ACCOUNT_TYPES, SMM_NETWORKS } from '@/types/firestore';
import type { SmmAccount, SmmNetwork } from '@/types/firestore';
import type { NetworkGroupState, SmmAccountPayload } from '@/hooks/useSmmAccounts';
import type { SmmUser } from '@/hooks/useSmmUsers';

const UNASSIGNED = '__unassigned__';
const COLS = 7;

/** Borderless input that saves on blur when the value changed. */
function EditableTextCell({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  // Re-sync the draft when the underlying value changes (render-phase
  // adjustment — the effect-free pattern React recommends).
  const [committed, setCommitted] = useState(value);
  if (committed !== value) {
    setCommitted(value);
    setDraft(value);
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== value) onSave(trimmed);
        else setDraft(value);
      }}
      className={`h-8 border-transparent bg-transparent shadow-none hover:border-input focus-visible:border-input dark:bg-transparent ${className ?? ''}`}
    />
  );
}

/** One account's row — every spec'd column editable inline. */
function AccountRow({
  account,
  users,
  onUpdate,
  onEdit,
  onStatusChange,
  onDelete,
}: {
  account: SmmAccount;
  users: SmmUser[];
  onUpdate: (id: string, updates: Partial<SmmAccountPayload>) => void;
  onEdit: (account: SmmAccount) => void;
  onStatusChange: (account: SmmAccount, status: string) => void;
  onDelete: (account: SmmAccount) => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <EditableTextCell
          value={account.accountName}
          onSave={(accountName) => onUpdate(account.id, { accountName })}
          className="font-medium"
        />
      </TableCell>
      <TableCell>
        <EditableTextCell
          value={account.accountLink}
          onSave={(accountLink) => onUpdate(account.id, { accountLink })}
          className="text-muted-foreground"
        />
      </TableCell>
      <TableCell>
        <MultiSelect
          options={SMM_ACCOUNT_TYPES}
          value={account.type}
          onChange={(type) => onUpdate(account.id, { type })}
          placeholder="Types"
          className="h-8 min-h-8 w-full border-transparent shadow-none hover:border-input"
        />
      </TableCell>
      <TableCell>
        <Select
          value={String(account.tier)}
          onValueChange={(tier) => onUpdate(account.id, { tier: Number(tier) })}
        >
          <SelectTrigger size="sm" className="w-full border-transparent shadow-none hover:border-input">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Tier 1</SelectItem>
            <SelectItem value="2">Tier 2</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={account.assigned ?? UNASSIGNED}
          onValueChange={(v) => onUpdate(account.id, { assigned: v === UNASSIGNED ? null : v })}
        >
          <SelectTrigger size="sm" className="w-full border-transparent shadow-none hover:border-input">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>
              <span className="text-muted-foreground">Unassigned</span>
            </SelectItem>
            {users.map((u) => <SelectItem key={u.uid} value={u.uid}>{u.displayName}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={account.status}
          onValueChange={(status) => {
            if (status !== account.status) onStatusChange(account, status);
          }}
        >
          <SelectTrigger size="sm" className="w-full border-transparent shadow-none hover:border-input">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right">
        <Popover>
          <PopoverTrigger asChild>
            <button className="p-1 rounded hover:bg-muted transition-colors" aria-label="Actions">
              <EllipsisIcon className="size-4 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-36 p-1">
            <div className="flex flex-col gap-0.5">
              <button
                className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                onClick={() => onEdit(account)}
              >
                Edit
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors text-red-600"
                onClick={() => onDelete(account)}
              >
                Delete
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </TableCell>
    </TableRow>
  );
}

/**
 * A collapsible network section rendered as rows inside the shared table: a
 * clickable group-header row plus, when open, that network's account rows.
 * Collapsed by default and its accounts are not fetched until the group is
 * first expanded (`onExpand`), so the page doesn't read the whole collection
 * up front. An active search force-expands every group to match across networks.
 */
function NetworkGroup({
  network,
  state,
  users,
  search,
  pendingEdits,
  onExpand,
  onUpdate,
  onEdit,
  onStatusChange,
  onDelete,
}: {
  network: SmmNetwork;
  state: NetworkGroupState;
  users: SmmUser[];
  search: string;
  pendingEdits: Record<string, Partial<SmmAccountPayload>>;
  onExpand: () => void;
  onUpdate: (id: string, updates: Partial<SmmAccountPayload>) => void;
  onEdit: (account: SmmAccount) => void;
  onStatusChange: (account: SmmAccount, status: string) => void;
  onDelete: (account: SmmAccount) => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const searchActive = search.trim().length > 0;
  // A search needs the group's data to match against, but the group should stay
  // collapsed (showing a spinner) until that data loads. Manual expansion opens
  // immediately regardless of matches.
  const wantData = manualOpen || searchActive;

  // Fetch lazily the first time the group is expanded or a search needs it.
  useEffect(() => {
    if (wantData && !state.loaded && !state.loading) onExpand();
  }, [wantData, state.loaded, state.loading, onExpand]);

  // Overlay any unsaved (staged) edits so the grid reflects them before Save.
  const filtered = useMemo(() => {
    const merged = state.accounts.map((a) => {
      const edit = pendingEdits[a.id];
      return edit ? { ...a, ...edit } as SmmAccount : a;
    });
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((a) => [
      a.accountName,
      a.accountLink,
      a.type.join(' '),
      String(a.tier),
      a.network,
      a.assignedName ?? '',
      a.status,
    ].join(' ').toLowerCase().includes(q));
  }, [state.accounts, search, pendingEdits]);

  // Once a search's results are in, only expand groups that actually matched —
  // a group with zero matches stays collapsed (its "0 of N" count still shows).
  const open = manualOpen || (searchActive && state.loaded && filtered.length > 0);

  return (
    <>
      <TableRow className="bg-muted/30 hover:bg-muted/30">
        <TableCell colSpan={COLS} className="p-0">
          <button
            type="button"
            onClick={() => setManualOpen((o) => !o)}
            disabled={searchActive}
            className="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-muted/50 disabled:hover:bg-transparent"
            aria-expanded={open}
          >
            <ChevronRightIcon
              className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
            />
            <NetworkBadge network={network} />
            {state.loading && !state.loaded ? (
              <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : state.loaded ? (
              <span className="text-xs text-muted-foreground">
                {searchActive
                  ? `${filtered.length} of ${state.accounts.length}`
                  : `${state.accounts.length} account${state.accounts.length === 1 ? '' : 's'}`}
              </span>
            ) : null}
          </button>
        </TableCell>
      </TableRow>

      {open && state.loading && !state.loaded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLS} className="py-2">
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          </TableCell>
        </TableRow>
      )}

      {/* Only reachable via manual expand with no search — a searched group with
          zero matches never opens (see `open` above), so it never needs this. */}
      {open && state.loaded && filtered.length === 0 && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLS} className="py-6 text-center text-sm text-muted-foreground">
            No accounts in this group.
          </TableCell>
        </TableRow>
      )}

      {open && filtered.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          users={users}
          onUpdate={onUpdate}
          onEdit={onEdit}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

/**
 * Admin account database as one table: shared column headers on top, with each
 * network a collapsible, lazily-loaded group of rows below. Status changes are
 * gated behind a confirm dialog.
 *
 * Memoized: the search input lives in the parent and updates on every keystroke,
 * but this heavy grid only re-renders when its (debounced) props actually change.
 */
export const AccountsDatabaseTable = memo(function AccountsDatabaseTable({
  groupFor,
  loadNetwork,
  users,
  search,
  pendingEdits,
  onStage,
  onEdit,
  onDelete,
}: {
  groupFor: (network: string) => NetworkGroupState;
  loadNetwork: (network: string) => void;
  users: SmmUser[];
  search: string;
  pendingEdits: Record<string, Partial<SmmAccountPayload>>;
  onStage: (id: string, updates: Partial<SmmAccountPayload>) => void;
  onEdit: (account: SmmAccount) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [pendingStatus, setPendingStatus] = useState<{ account: SmmAccount; status: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SmmAccount | null>(null);

  // Field edits are staged locally (not written) until the parent's Save button.
  const update = onStage;

  return (
    <>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-40">Account</TableHead>
              <TableHead className="min-w-44">Link</TableHead>
              <TableHead className="min-w-44">Type</TableHead>
              <TableHead className="w-24">Tier</TableHead>
              <TableHead className="min-w-40">Assigned</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {SMM_NETWORKS.map((network) => (
              <NetworkGroup
                key={network}
                network={network}
                state={groupFor(network)}
                users={users}
                search={search}
                pendingEdits={pendingEdits}
                onExpand={() => loadNetwork(network)}
                onUpdate={update}
                onEdit={onEdit}
                onStatusChange={(account, status) => setPendingStatus({ account, status })}
                onDelete={setPendingDelete}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Status change confirm (spec: alert dialog before toggling status) */}
      <ConfirmDialog
        open={!!pendingStatus}
        onOpenChange={(open) => !open && setPendingStatus(null)}
        title={`Set ${pendingStatus?.account.accountName} to ${pendingStatus?.status === 'active' ? 'Active' : 'Inactive'}?`}
        description={pendingStatus?.status === 'inactive'
          ? 'Inactive accounts are hidden from every dashboard, calendar and dropdown.'
          : 'The account will become visible on its assignee’s dashboard again.'}
        onConfirm={() => {
          if (pendingStatus) update(pendingStatus.account.id, { status: pendingStatus.status });
          setPendingStatus(null);
        }}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.accountName}?`}
        description="This permanently deletes the account and its entire content schedule. Bonus history is kept."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!pendingDelete) return;
          const account = pendingDelete;
          setPendingDelete(null);
          try {
            await onDelete(account.id);
            toast.success('Account deleted');
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete account');
          }
        }}
      />
    </>
  );
});
