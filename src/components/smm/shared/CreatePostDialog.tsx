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
import { DateTimePicker } from '@/components/smm/shared/DateTimePicker';
import { accountDisplayName } from '@/components/smm/shared/badges';
import type { SmmAccount } from '@/types/firestore';
import type { SmmPostPayload } from '@/hooks/useSmmPosts';
import type { ViralCopyDeclaration } from '@/components/smm/shared/ViralCopyDialog';

/** Midnight (a bare day click) becomes 09:00; an explicit time is kept. */
function startOfWorkday(date: Date): Date {
  if (date.getHours() !== 0 || date.getMinutes() !== 0) return date;
  const next = new Date(date);
  next.setHours(9, 0, 0, 0);
  return next;
}

/**
 * Schedule-a-post dialog, step two of the calendar-day flow (the viral-copy
 * question comes first — see {@link ViralCopyDialog}). Clicking a day prefills
 * postDate; postedBy is set server-side from the session.
 */
export function CreatePostDialog({
  open,
  onOpenChange,
  accounts,
  defaultDate,
  viralCopy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: SmmAccount[]; // active accounts assigned to the caller
  defaultDate?: Date;
  viralCopy?: ViralCopyDeclaration | null; // set when the post copies a viral post
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
    // A calendar-day click hands over midnight; open on a sensible hour so the
    // SMM edits a time rather than accidentally scheduling everything at 00:00.
    setPostDate(defaultDate ? startOfWorkday(defaultDate) : undefined);
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
        originalLink: viralCopy?.originalLink,
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
          {viralCopy && (
            <div className="rounded-lg border p-3 text-sm space-y-0.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Copied viral post
              </p>
              <p className="break-words">{viralCopy.originalLink}</p>
              {/* The source is not an input — it is the account the original
                  lives on, resolved from the link. It decides the network
                  bonus, so it is shown here rather than asked for. */}
              <p className="text-xs text-muted-foreground">
                Uploaded from <span className="text-foreground">{viralCopy.originalAccName}</span> ·
                {' '}this post’s bonus will be halved if you apply for one.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No accounts assigned to you</div>
                )}
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{accountDisplayName(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Post date &amp; time</Label>
            <DateTimePicker value={postDate} onChange={setPostDate} className="w-full" />
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
