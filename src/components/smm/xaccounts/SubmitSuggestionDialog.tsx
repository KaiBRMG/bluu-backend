'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSmmSuggestions } from '@/hooks/useSmmSuggestions';
import { accountHandle, extractAccountHandle } from '@/lib/smm/linkUtils';
import type { SmmAccount } from '@/types/firestore';

/**
 * "Submit Page Suggestion" — an SMM nominating an account worth copying viral
 * posts from. Only the link is asked for; the submitter, the timestamp and the
 * account handle are all derived server-side.
 *
 * `accounts` is the viral list the page already holds, used only to name an
 * already-listed page before the request is sent (zero extra reads). It covers
 * active accounts only — `POST /api/smm/suggestions` re-checks and is the gate.
 */
export function SubmitSuggestionDialog({
  open,
  onOpenChange,
  accounts = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts?: SmmAccount[];
}) {
  const { submitSuggestion } = useSmmSuggestions();
  const [accountLink, setAccountLink] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setAccountLink('');
  }, [open]);

  const handle = extractAccountHandle(accountLink);
  const alreadyViral = !!handle && accounts.some(
    (a) => accountHandle(a).toLowerCase() === handle.toLowerCase(),
  );

  const submit = async () => {
    setSaving(true);
    try {
      await submitSuggestion(accountLink.trim());
      toast.success('Suggestion submitted for review');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit suggestion');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit page suggestion</DialogTitle>
          <DialogDescription>
            Suggest an account for the viral list. An admin reviews it before it appears here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Account link</Label>
          <Input
            value={accountLink}
            onChange={(e) => setAccountLink(e.target.value)}
            placeholder="https://x.com/example"
          />
          {accountLink.trim() && !handle && (
            <p className="text-xs text-destructive">Enter a valid X/Twitter account link.</p>
          )}
          {handle && !alreadyViral && (
            <p className="text-xs text-muted-foreground">Account: @{handle}</p>
          )}
          {alreadyViral && (
            <p className="text-xs text-destructive">This account is already a Viral Account.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!handle || alreadyViral || saving}>
            {saving ? 'Submitting...' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
