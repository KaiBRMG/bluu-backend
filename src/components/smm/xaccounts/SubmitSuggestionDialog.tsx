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
import { extractAccountHandle } from '@/lib/smm/linkUtils';

/**
 * "Submit Page Suggestion" — an SMM nominating an account worth copying viral
 * posts from. Only the link is asked for; the submitter, the timestamp and the
 * account handle are all derived server-side.
 */
export function SubmitSuggestionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { submitSuggestion } = useSmmSuggestions();
  const [accountLink, setAccountLink] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setAccountLink('');
  }, [open]);

  const handle = extractAccountHandle(accountLink);

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
          {handle && <p className="text-xs text-muted-foreground">Account: @{handle}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!handle || saving}>
            {saving ? 'Submitting...' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
