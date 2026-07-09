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
import { DatePicker } from '@/components/smm/shared/DatePicker';
import type { SmmAccount } from '@/types/firestore';
import type { SmmPostPayload } from '@/hooks/useSmmPosts';

/**
 * Schedule-a-post dialog, opened by clicking an empty calendar day (which
 * prefills postDate). postedBy is set server-side from the session.
 */
export function CreatePostDialog({
  open,
  onOpenChange,
  accounts,
  defaultDate,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: SmmAccount[]; // active accounts assigned to the caller
  defaultDate?: Date;
  onCreate: (payload: SmmPostPayload) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState('');
  const [caption, setCaption] = useState('');
  const [postDate, setPostDate] = useState<Date | undefined>(undefined);
  const [postLink, setPostLink] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAccountId('');
    setCaption('');
    setPostDate(defaultDate);
    setPostLink('');
  }, [open, defaultDate]);

  // A post link is required and must be an x.com URL to enable Submit.
  const postLinkValid = postLink.trim().toLowerCase().includes('x.com');
  const canSubmit = !!accountId && !!postDate && postLinkValid && !saving;

  const handleCreate = async () => {
    if (!accountId || !postDate || !postLinkValid) return;
    setSaving(true);
    try {
      await onCreate({
        accountId,
        caption,
        postDate: postDate.toISOString(),
        postLink: postLink.trim(),
      });
      toast.success('Post scheduled');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule post');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule a post</DialogTitle>
          <DialogDescription>Add a post to your upload schedule.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No accounts assigned to you</div>
                )}
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Post date</Label>
            <DatePicker value={postDate} onChange={setPostDate} className="w-full" />
          </div>
          <div className="space-y-1.5">
            <Label>Caption</Label>
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Post link</Label>
            <Input value={postLink} onChange={(e) => setPostLink(e.target.value)} placeholder="https://x.com/..." />
            {postLink.trim() && !postLinkValid && (
              <p className="text-xs text-destructive">Enter a valid x.com post link.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {saving ? 'Scheduling...' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
