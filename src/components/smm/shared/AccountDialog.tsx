'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserChip } from '@/components/UserChip';
import { useUserName } from '@/hooks/useUserName';
import { AccountContentTable } from '@/components/smm/shared/AccountContentTable';
import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import { MultiSelect } from '@/components/smm/shared/MultiSelect';
import { AccountStatusBadge, NetworkBadge, TierBadge, TypeBadges } from '@/components/smm/shared/badges';
import { arrayEquals, buildDiff } from '@/lib/smm/diff';
import { SMM_ACCOUNT_TYPES, SMM_NETWORKS } from '@/types/firestore';
import type { SmmAccount, SmmTier } from '@/types/firestore';
import type { SmmAccountPayload } from '@/hooks/useSmmAccounts';
import type { SmmUser } from '@/hooks/useSmmUsers';

const UNASSIGNED = '__unassigned__';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm break-words">{children}</div>
    </div>
  );
}

/**
 * Large account dialog shared by the dashboard (mode="view": everything
 * read-only except the Content tab) and the admin database (mode="edit":
 * all fields editable except lastUpdatedTime/lastUpdatedBy).
 */
export function AccountDialog({
  account,
  open,
  onOpenChange,
  mode,
  users = [],
  onSave,
  postEditAccounts,
}: {
  account: SmmAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'view' | 'edit';
  users?: SmmUser[]; // SMM group members for the assigned picker (edit mode)
  onSave?: (id: string, updates: Partial<SmmAccountPayload>) => Promise<void>;
  postEditAccounts: SmmAccount[]; // account options for editing posts in the Content tab
}) {
  const { names } = useUserName();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SmmAccountPayload | null>(null);

  useEffect(() => {
    if (!account || !open) return;
    setForm({
      accountName: account.accountName,
      accountLink: account.accountLink,
      type: account.type,
      network: account.network,
      tier: account.tier,
      assigned: account.assigned,
      driveLink: account.driveLink,
      comments: account.comments,
      information: account.information,
      status: account.status,
    });
  }, [account, open]);

  // Single source of the changed fields — `dirty` and the PATCH body both
  // derive from it, so there's only one field list to keep in sync.
  const updates = useMemo(() => {
    if (!account || !form) return {} as Partial<SmmAccountPayload>;
    return buildDiff(
      form,
      account as unknown as SmmAccountPayload,
      ['accountName', 'accountLink', 'type', 'network', 'tier', 'assigned', 'driveLink', 'comments', 'information', 'status'],
      { type: arrayEquals },
    );
  }, [account, form]);
  const dirty = Object.keys(updates).length > 0;

  if (!account) return null;

  const assignedName = account.assignedName ?? (account.assigned ? names[account.assigned] ?? '' : '');
  const editing = mode === 'edit' && form;

  const patch = (updates: Partial<SmmAccountPayload>) =>
    setForm((f) => (f ? { ...f, ...updates } : f));

  const handleSave = async () => {
    if (!onSave || !form) return;
    setSaving(true);
    try {
      await onSave(account.id, updates);
      toast.success('Account updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          {editing ? (
            <div className="space-y-1.5 pr-6">
              <DialogTitle asChild>
                <Label>Account name</Label>
              </DialogTitle>
              <Input
                value={form.accountName}
                onChange={(e) => patch({ accountName: e.target.value })}
                className="text-lg font-semibold"
              />
            </div>
          ) : (
            <DialogTitle className="text-xl">{account.accountName}</DialogTitle>
          )}
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Account link">
            {editing ? (
              <Input value={form.accountLink} onChange={(e) => patch({ accountLink: e.target.value })} />
            ) : (
              <LinkWithCopy url={account.accountLink} />
            )}
          </Field>
          <Field label="Drive link">
            {editing ? (
              <Input value={form.driveLink ?? ''} onChange={(e) => patch({ driveLink: e.target.value })} />
            ) : (
              account.driveLink ? <LinkWithCopy url={account.driveLink} /> : <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Type">
            {editing ? (
              <MultiSelect
                options={SMM_ACCOUNT_TYPES}
                value={form.type}
                onChange={(type) => patch({ type })}
                placeholder="Select types"
                className="w-full"
              />
            ) : (
              account.type.length > 0 ? <TypeBadges type={account.type} /> : <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Network">
            {editing ? (
              <Select value={form.network} onValueChange={(network) => patch({ network })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SMM_NETWORKS.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <NetworkBadge network={account.network} />
            )}
          </Field>
          <Field label="Tier">
            {editing ? (
              <Select value={String(form.tier)} onValueChange={(tier) => patch({ tier: Number(tier) })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Tier 1</SelectItem>
                  <SelectItem value="2">Tier 2</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <TierBadge tier={account.tier as SmmTier} />
            )}
          </Field>
          <Field label="Assigned">
            {editing ? (
              <Select
                value={form.assigned ?? UNASSIGNED}
                onValueChange={(v) => patch({ assigned: v === UNASSIGNED ? null : v })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {users.map((u) => <SelectItem key={u.uid} value={u.uid}>{u.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              account.assigned
                ? <UserChip name={assignedName} photoURL={account.assignedPhotoURL ?? null} />
                : <span className="text-muted-foreground text-sm">No One</span>
            )}
          </Field>
          {editing && (
            <Field label="Status">
              <Select value={form.status} onValueChange={(status) => patch({ status })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          {!editing && (
            <Field label="Status"><AccountStatusBadge status={account.status} /></Field>
          )}
          <Field label="Comments">
            {editing ? (
              <Textarea
                value={form.comments ?? ''}
                onChange={(e) => patch({ comments: e.target.value })}
                rows={2}
              />
            ) : (
              account.comments
                ? <span className="whitespace-pre-wrap">{account.comments}</span>
                : <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Last updated">
            <span className="text-muted-foreground">
              {account.lastUpdatedTime ? format(new Date(account.lastUpdatedTime), 'PPp') : '—'}
              {mode === 'edit' && account.lastUpdatedByName ? ` · by ${account.lastUpdatedByName}` : ''}
            </span>
          </Field>
        </div>

        <Tabs defaultValue="information" className="mt-2">
          <TabsList>
            <TabsTrigger value="information">Information</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
          </TabsList>
          <TabsContent value="information" className="mt-3">
            {editing ? (
              <Textarea
                value={form.information ?? ''}
                onChange={(e) => patch({ information: e.target.value })}
                rows={6}
                placeholder="Account information, guidelines, notes..."
              />
            ) : account.information ? (
              <p className="text-sm whitespace-pre-wrap break-words">{account.information}</p>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">No information added yet.</p>
            )}
          </TabsContent>
          <TabsContent value="content" className="mt-3">
            <AccountContentTable accountId={account.id} accounts={postEditAccounts} />
          </TabsContent>
        </Tabs>

        {editing && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
