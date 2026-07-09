'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ApprovalBadge } from '@/components/smm/shared/badges';
import { PreviousRoundsDialog } from '@/components/smm/shared/PreviousRoundsDialog';
import { formatMoney, formatRoundDate } from '@/lib/smm/format';
import { useSmmBonus, type CurrentRoundMe } from '@/hooks/useSmmBonus';

/** Long sysComments collapse into a hover card. */
function SysCommentsCell({ text }: { text: string }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  const firstLine = text.split('\n')[0];
  const hasMore = text.includes('\n');
  if (!hasMore && firstLine.length <= 24) return <span className="text-sm">{firstLine}</span>;
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="link" className="h-auto p-0 text-sm font-normal text-foreground underline-offset-4">
          {firstLine.length > 24 ? firstLine.slice(0, 24) + '…' : firstLine}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent className="w-72">
        <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Dashboard "💰 Bonus System" section: current round header, the caller's
 * approved payout, their submissions this round, and previous rounds.
 * Reflects approved earnings only (userTotals is credited on approval).
 */
export function BonusSection() {
  const { fetchCurrentMe } = useSmmBonus();
  const [data, setData] = useState<CurrentRoundMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [prevOpen, setPrevOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchCurrentMe());
    } finally {
      setLoading(false);
    }
  }, [fetchCurrentMe]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">💰 Bonus System</h2>
          {loading ? (
            <Skeleton className="h-4 w-48 mt-1" />
          ) : data?.round ? (
            <>
              <p className="text-sm text-muted-foreground">
                Current Round: {formatRoundDate(data.round.roundDateStart)} – {formatRoundDate(data.round.roundDateEnd)}
              </p>
              <p className="text-sm mt-0.5">
                Your current payout for this round:{' '}
                <span className="font-semibold">{formatMoney(data.myTotal)}</span>
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No active bonus round.</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setPrevOpen(true)}>Show Previous Rounds</Button>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : data && data.submissions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Bonus</TableHead>
              <TableHead>System Comments</TableHead>
              <TableHead>Approval</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.submissions.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.accountName}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {s.submissionDate ? format(new Date(s.submissionDate), 'PP') : '—'}
                </TableCell>
                <TableCell>{formatMoney(s.bonusAmount)}</TableCell>
                <TableCell><SysCommentsCell text={s.sysComments} /></TableCell>
                <TableCell><ApprovalBadge value={s.adminApproval} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground py-4 text-center">No submissions this round yet.</p>
      )}

      <PreviousRoundsDialog open={prevOpen} onOpenChange={setPrevOpen} scope="me" />
    </section>
  );
}
