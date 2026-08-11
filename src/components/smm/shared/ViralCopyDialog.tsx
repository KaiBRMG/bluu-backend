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
import { useSmmBonus, type EligibilityResult } from '@/hooks/useSmmBonus';

export interface ViralCopyDeclaration {
  originalLink: string;
  /** The account the original lives on — resolved from the link, server-side. */
  originalAccName: string;
}

type Step = 'ask' | 'result';

/**
 * "Did you copy another viral post?" — step one of scheduling a post.
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
 * than recording a post whose source nobody can price.
 *
 * The result here is advisory — POST /api/smm/posts re-runs both checks.
 */
export function ViralCopyDialog({
  open,
  onOpenChange,
  onAnswered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = not a copy. Advances the caller to the Schedule-a-post dialog. */
  onAnswered: (declaration: ViralCopyDeclaration | null) => void;
}) {
  const { checkEligibility } = useSmmBonus();

  const [step, setStep] = useState<Step>('ask');
  const [originalLink, setOriginalLink] = useState('');
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('ask');
    setOriginalLink('');
    setEligibility(null);
  }, [open]);

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

  // Both gates must pass: the source is old enough to copy, AND its account is
  // one we can price a network bonus from.
  const accountFound = !!eligibility?.account;
  const canContinue = !!eligibility?.eligible && accountFound;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {step === 'ask' && (
          <>
            <DialogHeader>
              <DialogTitle>Did you copy another viral post?</DialogTitle>
              <DialogDescription>
                If this post copies someone else’s viral post, add the original below — a copied
                post earns half the bonus. Otherwise choose “No”.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label>Please paste the original post link</Label>
              <Input
                value={originalLink}
                onChange={(e) => setOriginalLink(e.target.value)}
                placeholder="https://x.com/..."
              />
              <p className="text-xs text-muted-foreground">
                We’ll work out which account it’s from — you don’t need to enter it.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onAnswered(null)}>No</Button>
              <Button onClick={runCheck} disabled={!originalLink.trim() || checking}>
                {checking ? 'Checking...' : 'Next'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'result' && eligibility && (
          <>
            <DialogHeader>
              <DialogTitle>
                {!accountFound
                  ? '⚠️ Account Not Found'
                  : eligibility.eligible ? '✅ Eligible' : '⚠️ Already Used Recently'}
              </DialogTitle>
              <DialogDescription>
                {!accountFound
                  ? `${eligibility.handle ? `@${eligibility.handle}` : 'That link'} isn’t in the account database, so we can’t tell which network you uploaded from. Use a post from a listed creator page, ask an admin to add it, or go back and answer “No”.`
                  : eligibility.eligible
                    ? 'This original post can be copied. Your bonus for it will be halved.'
                    : 'An original post may only be copied again once it is more than two weeks old. Go back and use a different post, or answer “No”.'}
              </DialogDescription>
            </DialogHeader>

            {(accountFound || eligibility.found) && (
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                {eligibility.account && (
                  <p>
                    <span className="text-muted-foreground">Account: </span>
                    {eligibility.account.name}
                    <span className="text-muted-foreground"> ({eligibility.account.network})</span>
                  </p>
                )}
                {eligibility.found && (
                  <>
                    <p>
                      <span className="text-muted-foreground">Uploaded: </span>
                      {eligibility.detail?.date ? format(new Date(eligibility.detail.date), 'PPp') : '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Uploaded by: </span>
                      {eligibility.detail?.userName || '—'}
                    </p>
                    {eligibility.daysDiff != null && (
                      <p className="tabular-nums">
                        <span className="text-muted-foreground">Age: </span>
                        {eligibility.daysDiff} day{eligibility.daysDiff === 1 ? '' : 's'} ago
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('ask')}>Back</Button>
              <Button
                onClick={() => onAnswered({
                  originalLink: originalLink.trim(),
                  originalAccName: eligibility.account?.name ?? '',
                })}
                disabled={!canContinue}
              >
                Next
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
