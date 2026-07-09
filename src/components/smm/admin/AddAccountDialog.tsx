'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/smm/shared/MultiSelect';
import { SMM_ACCOUNT_TYPES, SMM_NETWORKS } from '@/types/firestore';
import type { SmmAccountPayload } from '@/hooks/useSmmAccounts';
import type { SmmUser } from '@/hooks/useSmmUsers';

const UNASSIGNED = '__unassigned__';

export function AddAccountDialog({
  open,
  onOpenChange,
  users,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: SmmUser[];
  onCreate: (payload: SmmAccountPayload) => Promise<void>;
}) {
  const [accountName, setAccountName] = useState('');
  const [accountLink, setAccountLink] = useState('');
  const [type, setType] = useState<string[]>([]);
  const [network, setNetwork] = useState<string>('Other');
  const [tier, setTier] = useState('1');
  const [assigned, setAssigned] = useState(UNASSIGNED);
  const [driveLink, setDriveLink] = useState('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAccountName('');
    setAccountLink('');
    setType([]);
    setNetwork('Other');
    setTier('1');
    setAssigned(UNASSIGNED);
    setDriveLink('');
    setComments('');
  }, [open]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await onCreate({
        accountName,
        accountLink,
        type,
        network,
        tier: Number(tier),
        assigned: assigned === UNASSIGNED ? null : assigned,
        driveLink,
        comments,
        status: 'active',
      });
      toast.success('Account created');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>Register a new Twitter/X account in the database.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Account name *</Label>
              <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Account link *</Label>
              <Input value={accountLink} onChange={(e) => setAccountLink(e.target.value)} placeholder="https://x.com/..." />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <MultiSelect
              options={SMM_ACCOUNT_TYPES}
              value={type}
              onChange={setType}
              placeholder="Select types"
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Network</Label>
              <Select value={network} onValueChange={setNetwork}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SMM_NETWORKS.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tier</Label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Tier 1</SelectItem>
                  <SelectItem value="2">Tier 2</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Assigned</Label>
            <Select value={assigned} onValueChange={setAssigned}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {users.map((u) => <SelectItem key={u.uid} value={u.uid}>{u.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Drive link</Label>
            <Input value={driveLink} onChange={(e) => setDriveLink(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Comments</Label>
            <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!accountName.trim() || !accountLink.trim() || saving}>
            {saving ? 'Creating...' : 'Create account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
