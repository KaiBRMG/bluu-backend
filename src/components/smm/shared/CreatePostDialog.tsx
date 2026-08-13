'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DateTimePicker } from '@/components/smm/shared/DateTimePicker';
import { NetworkBadge, accountDisplayName } from '@/components/smm/shared/badges';
import { accountHandle, extractAccountHandle, linkMatchesHandle } from '@/lib/smm/linkUtils';
import { useSmmPostLinkCheck } from '@/hooks/useSmmPostLinkCheck';
import { useSmmAccountResolve, type SmmAccountResolution } from '@/hooks/useSmmAccountResolve';
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
 * Why the pasted link matched no account of the caller's. The three cases read
 * very differently to an SMM — one is a typo, one needs an assignment, one is a
 * data fix — so they are never collapsed into a single line. A failed or
 * still-unknown lookup falls back to "not in the database", the safest guess.
 */
function AccountMissMessage({
  handle, resolution,
}: { handle: string; resolution: SmmAccountResolution | null }) {
  const at = <span className="font-medium">@{handle}</span>;

  if (resolution?.exists && !resolution.active) {
    return (
      <p className="text-xs text-destructive">
        {at} is in the database but is marked inactive, so nothing can be scheduled on it. Ask
        your team leader to reactivate the account.
      </p>
    );
  }
  if (resolution?.exists && !resolution.mine) {
    return (
      <p className="text-xs text-destructive">
        {at} is in the database but is not assigned to you, so you cannot schedule posts on it.
        Ask your team leader to assign the account to you.
      </p>
    );
  }
  if (resolution?.exists) {
    // Assigned to the caller and active, yet it didn't match: the account's
    // saved link points at a different handle than its name (or the cached
    // account list predates the assignment).
    return (
      <p className="text-xs text-destructive">
        {at} is assigned to you, but its saved account link points at a different handle, so the
        post cannot be matched to it. Reload the page, and if it still fails, contact your team
        leader to fix the account link.
      </p>
    );
  }
  return (
    <p className="text-xs text-destructive">
      This link does not appear to come from any accounts in the database. Make sure it is
      correct and try again. If the account name is not the same as in the link, please contact
      your team leader to fix the account name.
    </p>
  );
}

/**
 * Schedule-a-post dialog — **step one** of the calendar-day flow. It collects
 * the post itself and validates the link, then hands a {@link PostDraft} to the
 * viral-copy question ({@link ViralCopyDialog}), which is what actually creates
 * the post. Nothing is written here.
 *
 * The account is never picked — like {@link ViralCopyDialog}, the handle is
 * already in the link, so it is resolved from `accounts` (the caller's own
 * active pages) as the SMM types. That removes the "wrong account selected"
 * mismatch entirely: an unmatched handle is simply not a page we can file the
 * post under, and blocks the draft.
 *
 * Three things must hold before the draft can move on, each checked here and
 * again server-side: the link is a Twitter/X post link, it resolves to one of
 * the caller's accounts, and it isn't already in the content schedule.
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
  const [caption, setCaption] = useState(draft?.caption ?? '');
  const [postDate, setPostDate] = useState<Date | undefined>(
    draft ? new Date(draft.postDate) : withCurrentTime(defaultDate),
  );
  const [postLink, setPostLink] = useState(draft?.postLink ?? '');

  // A post link is required and must be a Twitter/X link. The handle in it is
  // the account the post belongs to, so it is matched against the caller's own
  // pages here — the account decides the bonus tier and ownership, and a handle
  // we don't hold can't be verified. A restored draft re-resolves the same way,
  // so `draft.accountId` needs no state of its own.
  const trimmedLink = postLink.trim();
  const linkHandle = extractAccountHandle(trimmedLink);
  const linkShapeValid = !!linkHandle;
  const matchedAccount = linkShapeValid
    ? accounts.find((a) => linkMatchesHandle(trimmedLink, accountHandle(a)))
    : undefined;
  const accountNotFound = linkShapeValid && !matchedAccount;

  // A miss is ambiguous from here — the caller only holds their OWN accounts,
  // so "no such account" and "someone else's account" look identical. Ask the
  // server which it was, purely so the message can say the right thing.
  const { checking: resolving, resolution } = useSmmAccountResolve(postLink, {
    enabled: accountNotFound,
  });

  // Then: has this exact post already been recorded? Only asked once the link
  // is well-formed and resolves to an account — no point spending a query on a
  // link that is already rejected.
  const { checking: checkingDuplicate, duplicate } = useSmmPostLinkCheck(postLink, {
    enabled: !!matchedAccount,
  });

  const postLinkValid = !!matchedAccount && !duplicate;
  const canContinue = !!postDate && postLinkValid && !checkingDuplicate;

  const handleNext = () => {
    if (!matchedAccount || !postDate || !postLinkValid) return;
    onNext({
      accountId: matchedAccount.id,
      caption,
      postDate: postDate.toISOString(),
      postLink: trimmedLink,
    });
  };

  return (
    <>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Post link</Label>
          <Input
            value={postLink}
            onChange={(e) => setPostLink(e.target.value)}
            placeholder="https://x.com/..."
            aria-invalid={!!trimmedLink && !postLinkValid && !checkingDuplicate}
          />
          {!trimmedLink && (
            <p className="text-xs text-muted-foreground">
              Paste the link to your post — the account is matched from it automatically.
            </p>
          )}
          {trimmedLink && !linkShapeValid && (
            <p className="text-xs text-destructive">Enter a valid x.com or twitter.com post link.</p>
          )}
          {accountNotFound && (resolving
            ? <p className="text-xs text-muted-foreground">Looking up the account…</p>
            : <AccountMissMessage handle={linkHandle} resolution={resolution} />)}
          {/* The resolved account — the confirmation that the link was understood
              and which page the post is being filed under. */}
          {matchedAccount && (
            <div className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
              <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium">
                {accountDisplayName(matchedAccount)}
              </span>
              <NetworkBadge network={matchedAccount.network} />
            </div>
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
        <div className="space-y-1.5">
          <Label>Post date &amp; time</Label>
          <DateTimePicker value={postDate} onChange={setPostDate} className="w-full" />
        </div>
        <div className="space-y-1.5">
          <Label>Caption</Label>
          <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleNext} disabled={!canContinue}>Next</Button>
      </DialogFooter>
    </>
  );
}
