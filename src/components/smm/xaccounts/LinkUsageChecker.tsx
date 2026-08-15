'use client';

import { useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  ViralLinkReportCard, ViralLinkReportSkeleton, hasViralReport, viralLinkVerdict,
} from '@/components/smm/shared/ViralLinkReport';
import { useSmmBonus, type EligibilityResult } from '@/hooks/useSmmBonus';

/**
 * Look up a link's usage without scheduling anything — the same check
 * {@link ViralCopyDialog} runs at upload time, offered on its own so an SMM can
 * find out whether a post is worth copying *before* they copy it.
 *
 * It is deliberately the same call (`checkEligibility` →
 * `GET /api/smm/bonus/eligibility`), the same verdict (`viralLinkVerdict`) and
 * the same report ({@link ViralLinkReportCard}) — a second implementation would
 * eventually disagree with the one that gates the schedule, which is the worst
 * possible outcome for a tool whose whole job is to predict that gate.
 *
 * Nothing is written and nothing is decided here: this surface has no "Next",
 * so a pass or a fail is information only.
 */
export function LinkUsageChecker() {
  const { checkEligibility } = useSmmBonus();

  const [link, setLink] = useState('');
  const [checking, setChecking] = useState(false);
  /** The link the shown result belongs to — not the input, which keeps typing. */
  const [checkedLink, setCheckedLink] = useState('');
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);

  const runCheck = async () => {
    const trimmed = link.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    try {
      const result = await checkEligibility(trimmed);
      setEligibility(result);
      setCheckedLink(trimmed);
    } catch (err) {
      // Clear the old result rather than leaving it under a new link — a stale
      // verdict read as this link's is exactly the mistake this tool prevents.
      setEligibility(null);
      toast.error(err instanceof Error ? err.message : 'Failed to check this link');
    } finally {
      setChecking(false);
    }
  };

  const verdict = eligibility ? viralLinkVerdict(eligibility) : null;

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-semibold">Check a link</CardTitle>
        <CardDescription>
          Quickly check the usage of a link to determine if it is eligible for reposting.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 space-y-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); runCheck(); }}
        >
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://x.com/user/status/1950957999700258876"
              aria-label="Post link to check"
              className="pl-9"
            />
          </div>
          <Button type="submit" disabled={!link.trim() || checking} className="sm:w-28">
            {checking ? 'Checking...' : 'Check'}
          </Button>
        </form>

        {checking && <ViralLinkReportSkeleton />}

        {!checking && hasViralReport(eligibility) && verdict && (
          <div className="space-y-3">
            <div className="space-y-0.5">
              <p className={`flex items-center gap-1.5 text-sm font-semibold ${verdict.ink}`}>
                <verdict.Icon className="size-4 shrink-0" aria-hidden />
                {verdict.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {!verdict.accountFound
                  ? `${eligibility.handle ? `@${eligibility.handle}` : 'That link'} isn’t in the account database, so nothing can be recorded as copied from it. Ask an admin to add the page if it should be there.`
                  : !verdict.isViralAccount
                    ? 'This account is not listed on Viral Accounts, so its posts may not be copied. If you think this is a mistake, contact your team leader.'
                    : eligibility.eligible
                      ? 'This post can be reposted. Your bonus for a copy of it will be halved.'
                      : 'This post was used within the last two weeks, so it cannot be copied yet — the badge below shows when it frees up.'}
              </p>
            </div>
            <ViralLinkReportCard eligibility={eligibility} link={checkedLink} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
