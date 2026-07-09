'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SubmissionsTable } from '@/components/smm/admin/SubmissionsTable';
import { SubmissionDetailDialog } from '@/components/smm/admin/SubmissionDetailDialog';
import { EarningsTable } from '@/components/smm/admin/EarningsTable';
import { StartNewRoundDialog } from '@/components/smm/admin/StartNewRoundDialog';
import { PreviousRoundsDialog } from '@/components/smm/shared/PreviousRoundsDialog';
import { formatRoundDate } from '@/lib/smm/format';
import { useSmmBonus, type CurrentRoundAll } from '@/hooks/useSmmBonus';
import type { SmmSubmission } from '@/types/firestore';

/** Admin bonus management: submissions (75%) + earnings (25%), round controls. */
export function BonusManagementTab() {
  const {
    fetchCurrentAll, startRound, updateSubmission, deleteSubmission, updateUserTotal,
  } = useSmmBonus();

  const [data, setData] = useState<CurrentRoundAll | null>(null);
  const [loading, setLoading] = useState(true);
  const [startOpen, setStartOpen] = useState(false);
  const [prevOpen, setPrevOpen] = useState(false);
  const [selected, setSelected] = useState<SmmSubmission | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setData(await fetchCurrentAll(force));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load bonus data');
    } finally {
      setLoading(false);
    }
  }, [fetchCurrentAll]);

  useEffect(() => {
    load();
  }, [load]);

  const round = data?.round ?? null;

  const handleStartRound = async (start: string, end: string) => {
    await startRound(start, end);
    await load(true);
  };

  const handleSaveSubmission = async (
    submissionId: string,
    updates: Partial<Pick<SmmSubmission, 'numLikes' | 'status' | 'bonusAmount' | 'sysComments' | 'adminApproval'>>,
  ) => {
    if (!round) return;
    await updateSubmission(round.id, submissionId, updates);
    const fresh = await fetchCurrentAll(true);
    setData(fresh);
    // Keep the detail dialog in sync with the refreshed record.
    setSelected((prev) => (prev ? fresh.submissions.find((s) => s.id === prev.id) ?? null : null));
  };

  const handleDeleteSubmission = async (submission: SmmSubmission) => {
    if (!round) return;
    try {
      await deleteSubmission(round.id, submission.id);
      toast.success('Submission deleted');
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete submission');
    }
  };

  const handleUpdateTotal = async (uid: string, amount: number) => {
    if (!round) return;
    await updateUserTotal(round.id, uid, amount);
    await load(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bonus Management</h1>
          {loading ? (
            <Skeleton className="h-4 w-56 mt-1" />
          ) : round ? (
            <p className="text-sm text-muted-foreground">
              Current Round: {formatRoundDate(round.roundDateStart)} – {formatRoundDate(round.roundDateEnd)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No active round yet.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPrevOpen(true)}>Show Previous Rounds</Button>
          <Button onClick={() => setStartOpen(true)}>Start New Round</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <section className="lg:col-span-3 space-y-3">
          <h2 className="text-lg font-semibold">Submissions</h2>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <SubmissionsTable
              submissions={data?.submissions ?? []}
              onView={(s) => { setSelected(s); setDetailOpen(true); }}
              onDelete={handleDeleteSubmission}
            />
          )}
        </section>

        <section className="lg:col-span-1 space-y-3">
          <h2 className="text-lg font-semibold">Earnings</h2>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <EarningsTable totals={data?.userTotals ?? []} onUpdate={handleUpdateTotal} />
          )}
        </section>
      </div>

      <StartNewRoundDialog open={startOpen} onOpenChange={setStartOpen} onStart={handleStartRound} />
      <PreviousRoundsDialog open={prevOpen} onOpenChange={setPrevOpen} scope="all" />
      <SubmissionDetailDialog
        submission={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSave={handleSaveSubmission}
      />
    </div>
  );
}
