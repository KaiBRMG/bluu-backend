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
import type { SmmAccount } from '@/types/firestore';

export interface ViralCopyDeclaration {
  originalLink: string;
  originalAccId: string;
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
 * The result here is advisory — POST /api/smm/posts re-runs the same check.
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
  const { accounts } = useSmmAccounts('active');
  const { checkEligibility } = useSmmBonus();

  const [step, setStep] = useState<Step>('ask');
  const [originalLink, setOriginalLink] = useState('');
  const [originalAccId, setOriginalAccId] = useState('');
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('ask');
    setOriginalLink('');
    setOriginalAccId('');
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
                  options={accounts.map((a: SmmAccount) => ({ value: a.id, label: a.accountName }))}
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
              <Button variant="outline" onClick={() => onAnswered(null)}>No</Button>
              <Button onClick={runCheck} disabled={!originalLink.trim() || !originalAccId || checking}>
                {checking ? 'Checking...' : 'Next'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'result' && eligibility && (
          <>
            <DialogHeader>
              <DialogTitle>
                {eligibility.eligible ? '✅ Eligible' : '⚠️ Already Used Recently'}
              </DialogTitle>
              <DialogDescription>
                {eligibility.eligible
                  ? 'This original post can be copied. Your bonus for it will be halved.'
                  : 'An original post may only be copied again once it is more than two weeks old. Go back and use a different post, or answer “No”.'}
              </DialogDescription>
            </DialogHeader>

            {eligibility.found && (
              <div className="rounded-lg border p-3 space-y-1 text-sm">
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
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('ask')}>Back</Button>
              <Button
                onClick={() => onAnswered({ originalLink: originalLink.trim(), originalAccId })}
                disabled={!eligibility.eligible}
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
