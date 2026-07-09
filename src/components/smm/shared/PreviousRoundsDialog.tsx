'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRightIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatarLabel } from '@/components/UserAvatarLabel';
import { GroupHeaderRow } from '@/components/smm/shared/GroupHeaderRow';
import { EllipsisPagination } from '@/components/EllipsisPagination';
import { ApprovalBadge, SubmissionStatusBadge } from '@/components/smm/shared/badges';
import { formatMoney, formatRoundDate } from '@/lib/smm/format';
import { cn } from '@/lib/utils';
import { useSmmBonus, type PreviousRound } from '@/hooks/useSmmBonus';
import { format } from 'date-fns';

/**
 * Paginated previous-rounds view shared by both pages.
 *  - scope="me":  the caller's own submissions, one payout line per round
 *  - scope="all": every user's submissions, sub-grouped by user with per-user payout
 */
export function PreviousRoundsDialog({
  open,
  onOpenChange,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: 'me' | 'all';
}) {
  const { fetchPreviousRounds } = useSmmBonus();
  const [rounds, setRounds] = useState<PreviousRound[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const data = await fetchPreviousRounds(scope, p);
      setRounds(data.rounds);
      setTotalPages(data.totalPages);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load rounds');
    } finally {
      setLoading(false);
    }
  }, [fetchPreviousRounds, scope]);

  useEffect(() => {
    if (open) load(page);
  }, [open, page, load]);

  useEffect(() => {
    if (open) setPage(1);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Previous rounds</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rounds.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No previous rounds.</div>
        ) : (
          <div className="space-y-6">
            {rounds.map((r) => (
              <RoundBlock key={r.round.id} data={r} scope={scope} />
            ))}
          </div>
        )}

        <EllipsisPagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </DialogContent>
    </Dialog>
  );
}

function RoundBlock({ data, scope }: { data: PreviousRound; scope: 'me' | 'all' }) {
  const { round, submissions, userTotals } = data;
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-2 bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/50',
          open && 'border-b',
        )}
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="text-sm font-semibold">
          {formatRoundDate(round.roundDateStart)} – {formatRoundDate(round.roundDateEnd)}
        </span>
      </button>

      {open && (scope === 'all'
        ? <AllScopeTable submissions={submissions} userTotals={userTotals} />
        : <MeScopeTable submissions={submissions} total={userTotals[0]?.total ?? 0} />)}
    </div>
  );
}

function MeScopeTable({ submissions, total }: { submissions: PreviousRound['submissions']; total: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Submitted</TableHead>
          <TableHead>Bonus</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Approval</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {submissions.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="font-medium">{s.accountName}</TableCell>
            <TableCell className="whitespace-nowrap">{s.submissionDate ? format(new Date(s.submissionDate), 'PP') : '—'}</TableCell>
            <TableCell>{formatMoney(s.bonusAmount)}</TableCell>
            <TableCell><SubmissionStatusBadge status={s.status} /></TableCell>
            <TableCell><ApprovalBadge value={s.adminApproval} /></TableCell>
          </TableRow>
        ))}
        <TableRow className="bg-muted/30 font-semibold">
          <TableCell colSpan={2}>Payout</TableCell>
          <TableCell colSpan={3}>{formatMoney(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function AllScopeTable({
  submissions,
  userTotals,
}: {
  submissions: PreviousRound['submissions'];
  userTotals: PreviousRound['userTotals'];
}) {
  // Sub-group submissions by submittedBy; append that user's payout row.
  const byUser = new Map<string, PreviousRound['submissions']>();
  for (const s of submissions) {
    if (!byUser.has(s.submittedBy)) byUser.set(s.submittedBy, []);
    byUser.get(s.submittedBy)!.push(s);
  }
  const totalFor = (uid: string) => userTotals.find((t) => t.uid === uid)?.total ?? 0;

  // Collapsed submitter sub-groups (uids). Expanded by default.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (uid: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Submitted</TableHead>
          <TableHead>Bonus</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Approval</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...byUser.entries()].flatMap(([uid, subs]) => {
          const open = !collapsed.has(uid);
          return [
            <GroupHeaderRow key={`u-${uid}`} open={open} onToggle={() => toggle(uid)} colSpan={5} buttonClassName="pl-4">
              <UserAvatarLabel name={subs[0].submittedByName ?? ''} photoURL={subs[0].submittedByPhotoURL ?? null} size="md" />
            </GroupHeaderRow>,
            ...(open ? [
              ...subs.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.accountName}</TableCell>
                  <TableCell className="whitespace-nowrap">{s.submissionDate ? format(new Date(s.submissionDate), 'PP') : '—'}</TableCell>
                  <TableCell>{formatMoney(s.bonusAmount)}</TableCell>
                  <TableCell><SubmissionStatusBadge status={s.status} /></TableCell>
                  <TableCell><ApprovalBadge value={s.adminApproval} /></TableCell>
                </TableRow>
              )),
              <TableRow key={`t-${uid}`} className="font-medium">
                <TableCell colSpan={2} className="text-right text-muted-foreground">Payout</TableCell>
                <TableCell colSpan={3}>{formatMoney(totalFor(uid))}</TableCell>
              </TableRow>,
            ] : []),
          ];
        })}
      </TableBody>
    </Table>
  );
}
