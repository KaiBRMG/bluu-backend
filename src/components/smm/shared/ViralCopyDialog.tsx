'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ViralLinkReportCard, hasViralReport, viralLinkVerdict,
} from '@/components/smm/shared/ViralLinkReport';
import { useSmmBonus, type EligibilityResult } from '@/hooks/useSmmBonus';

export interface ViralCopyDeclaration {
  originalLink: string;
  /** The account the original lives on — resolved from the link, server-side. */
  originalAccName: string;
}

type Step = 'ask' | 'result';

/**
 * "Did you copy another viral post?" — **step one** of scheduling a post, asked
 * before the post itself is filled in ({@link CreatePostDialog}, step two).
 * Nothing is written here: the answer ("No", or a verified copy declaration) is
 * handed up to the page, which carries it into step two and stores it with the
 * post that step two creates.
 *
 * The copy declaration is made at UPLOAD time (not when applying for a bonus)
 * so the 2-week source rule is checked while the SMM can still act on it. A
 * source used within the last two weeks blocks the copy outright: the SMM must
 * pick another source or answer "No" and schedule an ordinary post.
 *
 * **The gates are a hard stop.** A failed check leaves only "Back" — there is
 * no way forward from the report other than returning to the question and
 * choosing a different original or answering "No".
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
  initialOriginalLink,
  onAnswered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The original link the SMM had already entered — set when step two sends
   * them back here, so a "Back" doesn't cost them the retyping. The check is
   * deliberately NOT restored with it: the gates must be passed again before
   * the copy can move on a second time.
   */
  initialOriginalLink?: string;
  /**
   * The answer, handed to step two. null = not a copy. Nothing is written
   * here — the post is created at the end of step two.
   */
  onAnswered: (declaration: ViralCopyDeclaration | null) => void;
}) {
  const { checkEligibility } = useSmmBonus();

  const [step, setStep] = useState<Step>('ask');
  const [originalLink, setOriginalLink] = useState(initialOriginalLink ?? '');
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('ask');
    setOriginalLink(initialOriginalLink ?? '');
    setEligibility(null);
    // `initialOriginalLink` is read only at open — a change while the dialog is
    // shown would otherwise wipe what the SMM is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // The three gates, derived where every surface derives them (see
  // ViralLinkReport) so the dialog and the Viral Accounts checker can never
  // reach different verdicts from the same payload.
  const verdict = eligibility ? viralLinkVerdict(eligibility) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={step === 'result' ? 'sm:max-w-2xl max-h-[88vh] overflow-y-auto' : 'sm:max-w-lg'}>
        {step === 'ask' && (
          <>
            <DialogHeader>
              <DialogTitle>Did you copy another viral post?</DialogTitle>
              <DialogDescription>
                If you copied a post from a Viral Account, add the original link below. Otherwise choose “No”.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label>Original Link</Label>
              <Input
                value={originalLink}
                onChange={(e) => setOriginalLink(e.target.value)}
                placeholder="https://x.com/user/status/1950957999700258876"
              />
              <p className="text-xs text-muted-foreground">
                This is the original viral post on{' '}
                <span className="font-semibold">another</span> account — not your own upload,
                which you’ll add on the next step.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={checking}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => onAnswered(null)} disabled={checking}>
                No
              </Button>
              <Button onClick={runCheck} disabled={!originalLink.trim() || checking}>
                {checking ? 'Checking...' : 'Next'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'result' && hasViralReport(eligibility) && verdict && (
          <>
            <DialogHeader>
              <DialogTitle className={`flex items-center gap-2 ${verdict.ink}`}>
                <verdict.Icon className="size-4 shrink-0" aria-hidden />
                {verdict.title}
              </DialogTitle>
              <DialogDescription>
                {!verdict.accountFound
                  ? `${eligibility.handle ? `@${eligibility.handle}` : 'That link'} isn’t in the account database, so we can’t tell which network you uploaded from. Use a post from a Viral Account, ask an admin to add it, or go back and answer “No”.`
                  : !verdict.isViralAccount
                    ? 'The selected account is not a viral account you may copy posts from. Please only use accounts from Viral Accounts. If you think this is a mistake, contact your team leader.'
                    : eligibility.eligible
                      ? 'This original post can be copied. Your bonus for it will be halved.'
                      : 'An original post may only be copied again once it is more than two weeks old — the badge below shows when this one frees up. Go back and use a different post, or answer “No”.'}
              </DialogDescription>
            </DialogHeader>

            <ViralLinkReportCard eligibility={eligibility} link={originalLink} />

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('ask')}>Back</Button>
              {/* A failed gate leaves Back as the only move — the copy cannot be
                  carried into step two, so the SMM must change the original or
                  answer "No". */}
              <Button
                onClick={() => onAnswered({
                  originalLink: originalLink.trim(),
                  originalAccName: eligibility.account?.name ?? '',
                })}
                disabled={!verdict.ok}
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
