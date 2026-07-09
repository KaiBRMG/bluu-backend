'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/smm/shared/Combobox';
import { useSmmAccounts } from '@/hooks/useSmmAccounts';
import { useSmmBonus, type EligibilityResult } from '@/hooks/useSmmBonus';
import { formatMoney } from '@/lib/smm/format';
import type { SmmPost } from '@/types/firestore';

type Step = 'viral' | 'eligibility' | 'submit' | 'done';

/**
 * Multi-step "💰 Submit for Bonus" wizard.
 * viral → (optional) eligibility → submit → done. The "No" branch on the
 * first step skips straight to submit. All bonus math is server-side; this
 * only collects inputs and shows the server's computed result.
 */
export function BonusWizard({
  post,
  open,
  onOpenChange,
  onSubmitted,
}: {
  post: SmmPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void; // fired after a successful submit so the caller can refresh (e.g. the 💰 marker)
}) {
  const { accounts } = useSmmAccounts('active');
  const { checkEligibility, submitBonus } = useSmmBonus();

  const [step, setStep] = useState<Step>('viral');
  const [originalLink, setOriginalLink] = useState('');
  const [originalAccId, setOriginalAccId] = useState('');
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [numLikes, setNumLikes] = useState('');
  const [screenshotLink, setScreenshotLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ bonusAmount: number; status: string; residualCreated: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('viral');
    setOriginalLink('');
    setOriginalAccId('');
    setEligibility(null);
    setNumLikes('');
    setScreenshotLink('');
    setResult(null);
  }, [open, post]);

  if (!post) return null;

  const runEligibility = async () => {
    setChecking(true);
    try {
      const res = await checkEligibility(originalLink);
      setEligibility(res);
      setStep('eligibility');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to check eligibility');
    } finally {
      setChecking(false);
    }
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await submitBonus({
        accountId: post.accountId,
        postId: post.id,
        originalLink: originalLink || undefined,
        originalAccId: originalAccId || undefined,
        numLikes: Number(numLikes),
        screenshotLink: screenshotLink || undefined,
      });
      setResult(res);
      setStep('done');
      // The submit flagged the post's bonusSubmission server-side; let the caller
      // refetch so the calendar's 💰 marker appears without a manual reload.
      onSubmitted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit bonus');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {step === 'viral' && (
          <>
            <DialogHeader>
              <DialogTitle>Did you copy another viral post?</DialogTitle>
              <DialogDescription>
                If this post copies someone else’s viral post, add the original below. Otherwise choose “No”.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Please paste the original post link</Label>
                <Input
                  value={originalLink}
                  onChange={(e) => setOriginalLink(e.target.value)}
                  placeholder="https://x.com/..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Please enter the account on which this is posted</Label>
                <Combobox
                  options={accounts.map((a) => ({ value: a.id, label: a.accountName }))}
                  value={originalAccId}
                  onChange={setOriginalAccId}
                  placeholder="Select account"
                  searchPlaceholder="Search accounts..."
                  emptyText="No accounts found."
                  className="w-full"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('submit')}>No</Button>
              <Button
                onClick={runEligibility}
                disabled={!originalLink.trim() || !originalAccId || checking}
              >
                {checking ? 'Checking...' : 'Next'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'eligibility' && eligibility && (
          <>
            <DialogHeader>
              <DialogTitle>Original post check</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {eligibility.found ? (
                <div className="rounded-lg border p-3 space-y-1">
                  <p><span className="text-muted-foreground">Found in: </span>{eligibility.source === 'post' ? 'Content schedule' : 'Previous bonus'}</p>
                  {eligibility.detail?.userName && (
                    <p><span className="text-muted-foreground">By: </span>{eligibility.detail.userName}</p>
                  )}
                  {eligibility.detail?.date && (
                    <p><span className="text-muted-foreground">Date: </span>{format(new Date(eligibility.detail.date), 'PPP')}</p>
                  )}
                  {eligibility.daysDiff != null && (
                    <p><span className="text-muted-foreground">Age: </span>{eligibility.daysDiff} day{eligibility.daysDiff === 1 ? '' : 's'} ago</p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">This link has not been used before.</p>
              )}
              <p className={`text-sm font-medium ${eligibility.eligible ? 'text-green-600' : 'text-amber-600'}`}>
                {eligibility.eligible ? '✅ Eligible' : '⚠️ This post has already been used recently'}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('viral')}>Back</Button>
              <Button onClick={() => setStep('submit')} disabled={!eligibility.eligible}>Next</Button>
            </DialogFooter>
          </>
        )}

        {step === 'submit' && (
          <>
            <DialogHeader>
              <DialogTitle>Submit your post information</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Post link: </span>{post.postLink || '—'}</p>
                <p><span className="text-muted-foreground">Post date: </span>{post.postDate ? format(new Date(post.postDate), 'PPP') : '—'}</p>
                {originalLink && (
                  <p><span className="text-muted-foreground">Original Link: </span>{originalLink}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Likes generated</Label>
                <Input
                  type="number"
                  min={0}
                  value={numLikes}
                  onChange={(e) => setNumLikes(e.target.value)}
                  placeholder="e.g. 12000"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Screenshot link</Label>
                <Input
                  value={screenshotLink}
                  onChange={(e) => setScreenshotLink(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(originalLink ? 'eligibility' : 'viral')}>Back</Button>
              <Button onClick={doSubmit} disabled={!numLikes || submitting}>
                {submitting ? 'Submitting...' : 'Submit'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'done' && result && (
          <>
            <DialogHeader>
              <DialogTitle>Bonus submitted</DialogTitle>
              <DialogDescription>Your submission is awaiting admin approval.</DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border p-4 text-center space-y-1">
              <p className="text-sm text-muted-foreground">{result.status}</p>
              <p className="text-3xl font-bold">{formatMoney(result.bonusAmount)}</p>
              {result.residualCreated && (
                <p className="text-xs text-muted-foreground">A residual bonus was shared with the original account’s owner.</p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
