'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DateTimePicker } from '@/components/smm/shared/DateTimePicker';
import { NetworkBadge, accountDisplayName } from '@/components/smm/shared/badges';
import { accountHandle, extractAccountHandle, isSameLink, linkMatchesHandle } from '@/lib/smm/linkUtils';
import { useSmmPostLinkCheck } from '@/hooks/useSmmPostLinkCheck';
import { useSmmAccountResolve, type SmmAccountResolution } from '@/hooks/useSmmAccountResolve';
import type { SmmAccount } from '@/types/firestore';

/**
 * The finished post, handed up to be written. `postDate` is an ISO instant —
 * the picker works in the user's local time and `toISOString()` converts it to
 * UTC, which is what the API and Firestore store.
 */
export interface PostDraft {
  accountId: string;
  caption: string;
  postDate: string;
  postLink: string;
}

/**
 * The form mid-edit, preserved across a "Back" to the viral-copy question so
 * nothing typed here is lost. Unlike {@link PostDraft} it may be incomplete —
 * no account has been matched yet, and the date can be cleared.
 */
export interface PostFormDraft {
  caption: string;
  postDate: string | null;
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
 * Schedule-a-post dialog — **step two** of the calendar-day flow, after the
 * viral-copy question ({@link ViralCopyDialog}) has been answered. It collects
 * the post itself, validates the link, and is what finally creates the post,
 * carrying whatever copy declaration step one produced.
 *
 * The account is never picked — like {@link ViralCopyDialog}, the handle is
 * already in the link, so it is resolved from `accounts` (the caller's own
 * active pages) as the SMM types. That removes the "wrong account selected"
 * mismatch entirely: an unmatched handle is simply not a page we can file the
 * post under, and blocks the write.
 *
 * Four things must hold before the post can be scheduled, each checked here and
 * again server-side: the link is a Twitter/X post link, it resolves to one of
 * the caller's accounts, it isn't already in the content schedule, and it isn't
 * the declared original itself. `postedBy` is set server-side from the session.
 */
export function CreatePostDialog({
  open,
  onOpenChange,
  accounts,
  defaultDate,
  draft,
  originalLink,
  onBack,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: SmmAccount[]; // active accounts assigned to the caller
  defaultDate?: Date;
  /** Form values to restore — set when a "Back" brought the SMM here again. */
  draft?: PostFormDraft | null;
  /** The original declared in step one, '' when the answer was "No". */
  originalLink?: string;
  /** Return to the viral-copy question, keeping what has been typed here. */
  onBack: (draft: PostFormDraft) => void;
  /**
   * Creates the post. Rejects on failure, which keeps this dialog open so the
   * SMM can retry rather than losing everything they typed.
   */
  onSubmit: (draft: PostDraft) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule a post</DialogTitle>
          <DialogDescription>
            {originalLink
              ? 'Add your post to the upload schedule. It will be recorded as a copy of the original you just verified.'
              : 'Add your post to the upload schedule.'}
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
            originalLink={originalLink}
            onBack={onBack}
            onSubmit={onSubmit}
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
  originalLink,
  onBack,
  onSubmit,
}: {
  accounts: SmmAccount[];
  defaultDate?: Date;
  draft?: PostFormDraft | null;
  originalLink?: string;
  onBack: (draft: PostFormDraft) => void;
  onSubmit: (draft: PostDraft) => Promise<void>;
}) {
  const [caption, setCaption] = useState(draft?.caption ?? '');
  // A restored draft keeps exactly what it held — including a cleared date,
  // which must not be silently refilled behind the SMM.
  const [postDate, setPostDate] = useState<Date | undefined>(
    draft
      ? (draft.postDate ? new Date(draft.postDate) : undefined)
      : withCurrentTime(defaultDate),
  );
  const [postLink, setPostLink] = useState(draft?.postLink ?? '');
  const [saving, setSaving] = useState(false);

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

  // The original declared in step one is a post on ANOTHER account that was
  // copied; this link is the new upload. The same link in both means the SMM
  // pasted the original here and no new upload is being recorded at all.
  const sameAsOriginal = isSameLink(trimmedLink, originalLink ?? '');

  const postLinkValid = !!matchedAccount && !duplicate && !sameAsOriginal;
  const canContinue = !!postDate && postLinkValid && !checkingDuplicate && !saving;

  const handleSubmit = async () => {
    if (!matchedAccount || !postDate || !postLinkValid) return;
    setSaving(true);
    try {
      await onSubmit({
        accountId: matchedAccount.id,
        caption,
        postDate: postDate.toISOString(),
        postLink: trimmedLink,
      });
    } catch (err) {
      // Stay open on failure — the draft only lives in memory, so closing here
      // would lose everything the SMM typed.
      toast.error(err instanceof Error ? err.message : 'Failed to schedule post');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => onBack({
    caption,
    postDate: postDate ? postDate.toISOString() : null,
    postLink,
  });

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
              Paste the link to your <span className="font-semibold">new</span> post — the link must be from an account assigned to you.
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
          {sameAsOriginal && (
            <p className="text-xs text-destructive">
              Post Link cannot be the same as the Original Link. The previous step recorded the
              original viral post on <span className="font-semibold">another</span> account. This
              form is for your <span className="font-semibold">new</span> post on one of{' '}
              <span className="font-semibold">your</span> accounts.
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
        <Button variant="outline" onClick={handleBack} disabled={saving}>Back</Button>
        <Button onClick={handleSubmit} disabled={!canContinue}>
          {saving ? 'Scheduling...' : 'Schedule post'}
        </Button>
      </DialogFooter>
    </>
  );
}
