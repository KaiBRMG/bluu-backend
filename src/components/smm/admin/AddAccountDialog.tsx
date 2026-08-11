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
import { extractAccountHandle } from '@/lib/smm/linkUtils';
import { TierField, ViralAccountField, tierError } from '@/components/smm/shared/TierField';
import { SMM_ACCOUNT_TYPES, SMM_NETWORKS } from '@/types/firestore';
import type { SmmTier } from '@/types/firestore';
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
  const [tier, setTier] = useState<SmmTier | null>(null);
  const [isViralBonus, setIsViralBonus] = useState(false);
  const [assigned, setAssigned] = useState(UNASSIGNED);
  const [driveLink, setDriveLink] = useState('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  // Once the admin edits the name themselves the link stops driving it — the
  // handle is a convenience, never an override of a deliberate name.
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNameTouched(false);
    setAccountName('');
    setAccountLink('');
    setType([]);
    setNetwork('Other');
    setTier(null);
    setIsViralBonus(false);
    setAssigned(UNASSIGNED);
    setDriveLink('');
    setComments('');
  }, [open]);

  // The name IS the handle in the link, so pasting the link fills it in. Kept
  // in sync while the field is untouched (clearing the name re-arms it), since
  // the handle is what `findAccountByHandle` matches on — a name that doesn't
  // match the link is what makes an account unfindable from a post link.
  const handleLinkChange = (value: string) => {
    setAccountLink(value);
    if (!nameTouched) setAccountName(extractAccountHandle(value));
  };

  const handleNameChange = (value: string) => {
    setAccountName(value);
    setNameTouched(value.trim() !== '');
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await onCreate({
        accountName,
        accountLink,
        type,
        network,
        tier,
        isViralBonus,
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
          {/* Link first: it fills the name in, so asking for it first is the
              order the admin actually works in. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Account link *</Label>
              <Input value={accountLink} onChange={(e) => handleLinkChange(e.target.value)} placeholder="https://x.com/..." />
            </div>
            <div className="space-y-1.5">
              <Label>Account name *</Label>
              <Input value={accountName} onChange={(e) => handleNameChange(e.target.value)} />
            </div>
          </div>
          <p className="-mt-1.5 text-xs text-muted-foreground">
            The name is taken from the link — change it if it’s wrong.
          </p>
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
            <TierField type={type} tier={tier} onChange={setTier} />
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
          <ViralAccountField value={isViralBonus} onChange={setIsViralBonus} />
          <div className="space-y-1.5">
            <Label>Comments</Label>
            <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={!accountName.trim() || !accountLink.trim() || !!tierError(type, tier) || saving}
          >
            {saving ? 'Creating...' : 'Create account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
