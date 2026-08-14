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
import { useSmmBonus, type SubmitBonusResult } from '@/hooks/useSmmBonus';
import { formatMoney } from '@/lib/smm/format';
import type { SmmPost } from '@/types/firestore';

type Step = 'submit' | 'done';

/**
 * "💰 Submit for Bonus". Collects the like count + screenshot and shows the
 * server's computed payout — all bonus math is server-side.
 *
 * The viral-copy question is NOT asked here: it is answered when the post is
 * scheduled (see {@link ViralCopyDialog}) and stored on the post, so the
 * halving is already decided by the time an SMM applies.
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
  const { submitBonus } = useSmmBonus();

  const [step, setStep] = useState<Step>('submit');
  const [numLikes, setNumLikes] = useState('');
  const [screenshotLink, setScreenshotLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitBonusResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('submit');
    setNumLikes('');
    setScreenshotLink('');
    setResult(null);
  }, [open, post]);

  if (!post) return null;

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await submitBonus({
        accountId: post.accountId,
        postId: post.id,
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
        {step === 'submit' && (
          <>
            <DialogHeader>
              <DialogTitle>Submit your post information</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Post link: </span>{post.postLink || '—'}</p>
                <p>
                  <span className="text-muted-foreground">Post date: </span>
                  {post.postDate ? format(new Date(post.postDate), 'PPp') : '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Uploaded from: </span>
                  {post.sourceAccName || 'not recorded — no network bonus'}
                </p>
                {post.isViralCopy && (
                  <>
                    <p className="break-words">
                      <span className="text-muted-foreground">Original Link: </span>{post.originalLink}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Declared as a copied viral post when scheduled — this bonus is halved.
                    </p>
                  </>
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
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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
              <p className="text-2xl font-semibold tabular-nums">{formatMoney(result.bonusAmount)}</p>
              {result.suggestionShareCreated && (
                <p className="text-xs text-muted-foreground">
                  A $2 share was sent to the SMM who suggested this creator page.
                </p>
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
