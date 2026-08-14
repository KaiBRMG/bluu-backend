'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserAvatarLabel } from '@/components/UserAvatarLabel';
import { ApprovalBadge, SubmissionStatusBadge } from '@/components/smm/shared/badges';
import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import { formatMoney } from '@/lib/smm/format';
import { isSameLink } from '@/lib/smm/linkUtils';
import { useSmmBonus, type EligibilityResult } from '@/hooks/useSmmBonus';
import type { SmmPost, SmmSubmission } from '@/types/firestore';

export interface ViralCopyDeclaration {
  originalLink: string;
  /** The account the original lives on — resolved from the link, server-side. */
  originalAccName: string;
}

type Step = 'ask' | 'result';

/** Section label + result count, shared by all three report blocks below. */
function ReportSectionHeader({
  label, hint, count,
}: { label: string; hint: string; count: number }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      {count > 0 && <Badge variant="secondary" className="shrink-0 font-normal tabular-nums">{count}</Badge>}
    </div>
  );
}

/** Empty-state line for a report section, matching DESIGN's "one quiet line" rule. */
function ReportEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">{children}</p>
  );
}

/** A scheduled post found by the search — used for both the original-post and copies sections. */
function ReportPostRow({ post }: { post: SmmPost }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <UserAvatarLabel
        name={post.postedByName ?? ''}
        photoURL={post.postedByPhotoURL ?? null}
        className="min-w-0 flex-1"
      />
      <span className="hidden shrink-0 max-w-[8rem] truncate text-xs text-muted-foreground sm:inline">
        {post.accountName}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {post.postDate ? format(new Date(post.postDate), 'PP') : '—'}
      </span>
      {post.bonusSubmission && (
        <span className="shrink-0 text-sm" role="img" title="Submitted for bonus" aria-label="Submitted for bonus">
          💰
        </span>
      )}
      <LinkWithCopy url={post.postLink} className="max-w-[8rem] shrink-0" />
    </div>
  );
}

/** A bonus submission found by the search. */
function ReportSubmissionRow({ submission }: { submission: SmmSubmission }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <UserAvatarLabel
        name={submission.submittedByName ?? ''}
        photoURL={submission.submittedByPhotoURL ?? null}
        className="min-w-0 flex-1"
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {submission.submissionDate ? format(new Date(submission.submissionDate), 'PP') : '—'}
      </span>
      <span className="shrink-0 text-sm font-medium tabular-nums">{formatMoney(submission.bonusAmount)}</span>
      <SubmissionStatusBadge status={submission.status} />
      <ApprovalBadge value={submission.adminApproval} />
    </div>
  );
}

/**
 * "Did you copy another viral post?" — **step two** of scheduling a post, after
 * the post itself has been filled in ({@link CreatePostDialog}). This dialog is
 * what actually creates the post: "No" schedules an ordinary post, and a
 * verified copy schedules one carrying the declaration.
 *
 * The copy declaration is made at UPLOAD time (not when applying for a bonus)
 * so the 2-week source rule is checked while the SMM can still act on it. A
 * source used within the last two weeks blocks the copy outright: the SMM must
 * pick another source or answer "No" and schedule an ordinary post.
 *
 * The account is never typed in — the handle is already in the link, so the
 * eligibility check resolves it against `twitterx-accounts` and returns it.
 * That account is also the post's "uploaded from" source, which is what pays
 * the network bonus; an unknown handle therefore blocks the copy too, rather
 * than recording a post whose source nobody can price. A handle that resolves
 * to an account which is not `isViralBonus` blocks it as well — only pages
 * listed on Viral Accounts may be copied from, so un-ticking that flag retires
 * a page for everyone straight away.
 *
 * The result here is advisory — POST /api/smm/posts re-runs both checks.
 */
export function ViralCopyDialog({
  open,
  onOpenChange,
  postLink,
  onBack,
  onAnswered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The link from step one — the NEW upload, which the original can't equal. */
  postLink: string;
  /** Return to step one with the draft intact. */
  onBack: () => void;
  /**
   * Creates the post. null = not a copy. Rejects on failure, which keeps this
   * dialog open so the SMM can retry rather than losing the draft.
   */
  onAnswered: (declaration: ViralCopyDeclaration | null) => Promise<void>;
}) {
  const { checkEligibility } = useSmmBonus();

  const [step, setStep] = useState<Step>('ask');
  const [originalLink, setOriginalLink] = useState('');
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('ask');
    setOriginalLink('');
    setEligibility(null);
  }, [open]);

  // The original is a post on ANOTHER account that was copied; the post link
  // from step one is the new upload. The same link in both means the SMM
  // pasted their own post here and no copy is being declared at all.
  const sameAsPostLink = isSameLink(originalLink, postLink);

  const runCheck = async () => {
    setChecking(true);
    try {
      setEligibility(await checkEligibility(originalLink));
      setStep('result');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to check the original post');
    } finally {
      setChecking(false);
    }
  };

  /** Both answers land here — this is where the post is finally created. */
  const answer = async (declaration: ViralCopyDeclaration | null) => {
    setSaving(true);
    try {
      await onAnswered(declaration);
    } catch (err) {
      // Stay open on failure — the draft is only held in memory, so closing
      // here would lose everything the SMM typed in step one.
      toast.error(err instanceof Error ? err.message : 'Failed to schedule post');
    } finally {
      setSaving(false);
    }
  };

  // Three gates must pass: the account exists, it is a listed Viral Account,
  // and the source is old enough to copy.
  const accountFound = !!eligibility?.account;
  const isViralAccount = eligibility?.account?.isViralBonus === true;
  const canContinue = !!eligibility?.eligible && accountFound && isViralAccount;

  // The single verdict, in the order the gates are applied: an unknown account
  // blocks regardless of anything else, and a non-viral one blocks regardless
  // of age — so both win over the two-week rule.
  const statusLabel = !accountFound
    ? 'Account not found'
    : !isViralAccount
      ? 'Not a viral account'
      : eligibility?.eligible
        ? (eligibility.found ? 'Eligible — old enough to copy' : 'Eligible — never used')
        : 'Already used recently';

  const report = eligibility?.report;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={step === 'result' ? 'sm:max-w-2xl max-h-[88vh] overflow-y-auto' : 'sm:max-w-lg'}>
        {step === 'ask' && (
          <>
            <DialogHeader>
              <DialogTitle>Did you copy another viral post?</DialogTitle>
              <DialogDescription>
                If you used a post from a Viral Account, add the original link below — a copied
                post earns half the bonus. Otherwise choose “No”.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label>Please paste the original post link</Label>
              <Input
                value={originalLink}
                onChange={(e) => setOriginalLink(e.target.value)}
                placeholder="https://x.com/user/status/1950957999700258876"
                aria-invalid={sameAsPostLink}
              />
              {sameAsPostLink && (
                <p className="text-xs text-destructive">
                  Original Link cannot be the same as Post Link. The previous form records your
                  new post on one of <span className="font-semibold">your</span> accounts. This
                  form is for the link of the original viral post on{' '}
                  <span className="font-semibold">another</span> account, if you copied one.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onBack} disabled={checking || saving}>Back</Button>
              <Button variant="outline" onClick={() => answer(null)} disabled={checking || saving}>
                {saving ? 'Scheduling...' : 'No'}
              </Button>
              <Button
                onClick={runCheck}
                disabled={!originalLink.trim() || sameAsPostLink || checking || saving}
              >
                {checking ? 'Checking...' : 'Next'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'result' && eligibility && report && (
          <>
            <DialogHeader>
              <DialogTitle>
                {!accountFound
                  ? '⚠️ Account Not Found'
                  : !isViralAccount
                    ? '⚠️ Not a Viral Account'
                    : eligibility.eligible ? '✅ Eligible' : '⚠️ Already Used Recently'}
              </DialogTitle>
              <DialogDescription>
                {!accountFound
                  ? `${eligibility.handle ? `@${eligibility.handle}` : 'That link'} isn’t in the account database, so we can’t tell which network you uploaded from. Use a post from a listed creator page, ask an admin to add it, or go back and answer “No”.`
                  : !isViralAccount
                    ? 'The selected account is not a viral account you may copy posts from. Please only use accounts from Viral Accounts. If you think this is a mistake, contact your team leader.'
                    : eligibility.eligible
                      ? 'This original post can be copied. Your bonus for it will be halved.'
                      : 'An original post may only be copied again once it is more than two weeks old. Go back and use a different post, or answer “No”.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* PRIMARY — the search's verdict: pass or fail, always rendered. */}
              <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={canContinue ? 'secondary' : 'destructive'}>{statusLabel}</Badge>
                </div>
                <p className="break-all">
                  <span className="text-muted-foreground">Original link: </span>
                  {originalLink.trim() || '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Account: </span>
                  {eligibility.account
                    ? (
                      <>
                        {eligibility.account.name}
                        <span className="text-muted-foreground"> ({eligibility.account.network})</span>
                        {!isViralAccount && (
                          <span className="text-destructive"> — not a Viral Account</span>
                        )}
                      </>
                    )
                    : <span className="text-destructive">
                        {eligibility.handle ? `@${eligibility.handle} — not in the account database` : 'Not found in the database'}
                      </span>}
                </p>
                {eligibility.found && (
                  <p className="tabular-nums">
                    <span className="text-muted-foreground">Last used: </span>
                    {eligibility.daysDiff != null ? `${eligibility.daysDiff} day${eligibility.daysDiff === 1 ? '' : 's'} ago` : '—'}
                    <span className="text-muted-foreground"> (as {eligibility.source === 'submission' ? 'a bonus submission source' : 'a scheduled post'})</span>
                  </p>
                )}
              </div>

              {/* PRIMARY — the post whose OWN link matches: the original itself. */}
              <div className="space-y-1.5">
                <ReportSectionHeader
                  label="Original post"
                  hint="The post in the schedule whose own link is this exact link."
                  count={report.originalPost ? 1 : 0}
                />
                {report.originalPost ? (
                  <div className="rounded-lg border">
                    <ReportPostRow post={report.originalPost} />
                  </div>
                ) : (
                  <ReportEmpty>No post in the schedule uses this exact link.</ReportEmpty>
                )}
              </div>

              {/* SECONDARY — other posts that also copied this same original. */}
              <div className="space-y-1.5">
                <ReportSectionHeader
                  label="Other copies of this original"
                  hint="Posts that declared this link as their own copy source, not the original itself."
                  count={report.copies.length}
                />
                {report.copies.length === 0 ? (
                  <ReportEmpty>No other posts have copied this original.</ReportEmpty>
                ) : (
                  <div className="rounded-lg border divide-y">
                    {report.copies.map((p) => <ReportPostRow key={p.id} post={p} />)}
                  </div>
                )}
              </div>

              {/* Bonus submissions filed against this original. */}
              <div className="space-y-1.5">
                <ReportSectionHeader
                  label="Bonus submissions"
                  hint="Bonuses filed with this link as their copy source, paid or pending."
                  count={report.submissions.length}
                />
                {report.submissions.length === 0 ? (
                  <ReportEmpty>No bonus has been submitted against this original.</ReportEmpty>
                ) : (
                  <div className="rounded-lg border divide-y">
                    {report.submissions.map((s) => <ReportSubmissionRow key={s.id} submission={s} />)}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('ask')} disabled={saving}>Back</Button>
              <Button
                onClick={() => answer({
                  originalLink: originalLink.trim(),
                  originalAccName: eligibility.account?.name ?? '',
                })}
                disabled={!canContinue || saving}
              >
                {saving ? 'Scheduling...' : 'Schedule post'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
