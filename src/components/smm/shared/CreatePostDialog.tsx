'use client';

import { useState } from 'react';
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
import { accountHandle, extractAccountHandle, linkMatchesHandle } from '@/lib/smm/linkUtils';
import { useSmmPostLinkCheck } from '@/hooks/useSmmPostLinkCheck';
import type { SmmAccount } from '@/types/firestore';

/**
 * The post as filled in here, handed to the viral-copy step. `postDate` is an
 * ISO instant — the picker works in the user's local time and `toISOString()`
 * converts it to UTC, which is what the API and Firestore store.
 */
export interface PostDraft {
  accountId: string;
  caption: string;
  postDate: string;
  postLink: string;
}

/**
 * A day click hands over that day at midnight. Keep the chosen day but default
 * the clock to the user's current local time, so an SMM scheduling "now" has
 * nothing to adjust. An explicit time (a real edit, or a restored draft) wins.
 */
function withCurrentTime(date: Date | undefined): Date {
  const now = new Date();
  if (!date) return now;
  if (date.getHours() !== 0 || date.getMinutes() !== 0) return date;
  const next = new Date(date);
  next.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return next;
}

/**
 * Schedule-a-post dialog — **step one** of the calendar-day flow. It collects
 * the post itself and validates the link, then hands a {@link PostDraft} to the
 * viral-copy question ({@link ViralCopyDialog}), which is what actually creates
 * the post. Nothing is written here.
 *
 * Three things must hold before the draft can move on, each checked here and
 * again server-side: the link is a Twitter/X post link, it is a post on the
 * account selected above, and it isn't already in the content schedule.
 * `postedBy` is set server-side from the session.
 */
export function CreatePostDialog({
  open,
  onOpenChange,
  accounts,
  defaultDate,
  draft,
  onNext,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: SmmAccount[]; // active accounts assigned to the caller
  defaultDate?: Date;
  /** A draft to restore — set when the viral step sends the SMM back here. */
  draft?: PostDraft | null;
  onNext: (draft: PostDraft) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule a post</DialogTitle>
          <DialogDescription>
            Add a post to your upload schedule. You’ll be asked about viral copies next.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the form's state is seeded from `draft`
            (or the defaults) once per opening — no effect syncing props into
            state, and no stale values from the previous post. */}
        {open && (
          <PostForm
            accounts={accounts}
            defaultDate={defaultDate}
            draft={draft}
            onNext={onNext}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PostForm({
  accounts,
  defaultDate,
  draft,
  onNext,
  onCancel,
}: {
  accounts: SmmAccount[];
  defaultDate?: Date;
  draft?: PostDraft | null;
  onNext: (draft: PostDraft) => void;
  onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState(draft?.accountId ?? '');
  const [caption, setCaption] = useState(draft?.caption ?? '');
  const [postDate, setPostDate] = useState<Date | undefined>(
    draft ? new Date(draft.postDate) : withCurrentTime(defaultDate),
  );
  const [postLink, setPostLink] = useState(draft?.postLink ?? '');

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const selectedHandle = selectedAccount ? accountHandle(selectedAccount) : '';

  // A post link is required, must be a Twitter/X link, and must be a post on
  // the account picked above — the dropdown is what decides the bonus tier and
  // ownership, so a link pointing at a different page can't be verified.
  const trimmedLink = postLink.trim();
  const linkHandle = extractAccountHandle(trimmedLink);
  const linkShapeValid = !!linkHandle;
  const handleMismatch = linkShapeValid && !!selectedHandle
    && !linkMatchesHandle(trimmedLink, selectedHandle);

  // Then: has this exact post already been recorded? Only asked once the link
  // is well-formed and matches the account — no point spending a query on a
  // link that is already rejected.
  const { checking: checkingDuplicate, duplicate } = useSmmPostLinkCheck(postLink, {
    enabled: linkShapeValid && !handleMismatch,
  });

  const postLinkValid = linkShapeValid && !handleMismatch && !duplicate;
  const canContinue = !!accountId && !!postDate && postLinkValid && !checkingDuplicate;

  const handleNext = () => {
    if (!accountId || !postDate || !postLinkValid) return;
    onNext({
      accountId,
      caption,
      postDate: postDate.toISOString(),
      postLink: trimmedLink,
    });
  };

  return (
    <>
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
          <Input
            value={postLink}
            onChange={(e) => setPostLink(e.target.value)}
            placeholder={selectedHandle ? `https://x.com/${selectedHandle}/status/...` : 'https://x.com/...'}
            aria-invalid={!!trimmedLink && !postLinkValid && !checkingDuplicate}
          />
          {trimmedLink && !linkShapeValid && (
            <p className="text-xs text-destructive">Enter a valid x.com or twitter.com post link.</p>
          )}
          {handleMismatch && (
            <p className="text-xs text-destructive">
              This link is a post on <span className="font-medium">@{linkHandle}</span>, but the
              selected account is <span className="font-medium">@{selectedHandle}</span>. Pick the
              matching account or paste that account’s post link.
            </p>
          )}
          {duplicate && (
            <p className="text-xs text-destructive">
              This post already exists in the database. This form is to record a{' '}
              <span className="font-semibold">new</span> post upload to one of{' '}
              <span className="font-semibold">your</span> accounts.
            </p>
          )}
          {checkingDuplicate && (
            <p className="text-xs text-muted-foreground">Checking the schedule for this post…</p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleNext} disabled={!canContinue}>Next</Button>
      </DialogFooter>
    </>
  );
}
