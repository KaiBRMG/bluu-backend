'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLinkIcon, PlusIcon } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatCount } from '@/lib/growth/metrics';
import { PlatformIcon, ScrapeStatus } from './growthUi';
import { AddAccountDialog } from './AddAccountDialog';
import type { AddGrowthAccountPayload } from '@/hooks/useGrowthTracking';
import type { GrowthAccount } from '@/types/firestore';

/**
 * The management dashboard: which accounts get scraped, and whether the scraping
 * is working.
 *
 * Two deliberate shapes here:
 *
 * **Removing is stopping, not deleting.** Stopping ends the nightly cost and
 * takes the account off the active roster while keeping every reading, and it
 * is reversible in one click. Permanent deletion exists, but only from the
 * stopped list and behind a confirm that names how much history it destroys —
 * months of daily readings cannot be re-collected from anywhere.
 *
 * **The cost is stated, not implied.** Someone adding their twentieth account
 * should be able to see what that does to the bill without going and reading
 * the service file.
 */

/** Matches UNIT_COST in growthTrackingService.ts — repeated here as a display estimate only. */
const NIGHTLY_COST: Record<GrowthAccount['platform'], number> = { facebook: 0.01, twitter: 0.004 };

interface ManageAccountsTabProps {
  accounts: GrowthAccount[];
  loading: boolean;
  onAdd: (payload: AddGrowthAccountPayload) => Promise<void>;
  onSetTracking: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function ManageAccountsTab({
  accounts, loading, onAdd, onSetTracking, onDelete,
}: ManageAccountsTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GrowthAccount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { active, stopped, monthlyCost } = useMemo(() => {
    const activeAccounts = accounts.filter((a) => a.isActive);
    return {
      active: activeAccounts,
      stopped: accounts.filter((a) => !a.isActive),
      monthlyCost: activeAccounts.reduce((sum, a) => sum + NIGHTLY_COST[a.platform], 0) * 30,
    };
  }, [accounts]);

  const setTracking = async (account: GrowthAccount, isActive: boolean) => {
    setBusyId(account.id);
    try {
      await onSetTracking(account.id, isActive);
      toast.success(isActive
        ? `Tracking ${account.displayName} again`
        : `Stopped tracking ${account.displayName}. Its history is kept.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update that account.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const account = pendingDelete;
    setPendingDelete(null);
    setBusyId(account.id);
    try {
      await onDelete(account.id);
      toast.success(`Deleted ${account.displayName} and all of its history`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that account.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[65ch] text-sm text-zinc-400">
          {active.length === 0
            ? 'No accounts are being scraped. Add one to start collecting follower counts.'
            : <>
                <span className="tabular-nums text-zinc-300">{active.length}</span>
                {' account'}{active.length === 1 ? '' : 's'}{' scraped nightly at midnight UTC · about '}
                <span className="tabular-nums text-zinc-300">${monthlyCost.toFixed(2)}</span>
                {' a month'}
              </>}
        </p>
        <Button onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-4" aria-hidden />
          Track Account
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Nothing is tracked yet. Add a Facebook page or X account and its follower count is
          recorded from tonight onwards.
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Followers</TableHead>
                <TableHead className="text-right">Last read</TableHead>
                <TableHead className="w-[7rem]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((account) => (
                <TableRow key={account.id} className="hover:bg-white/[0.055]">
                  <TableCell className="max-w-0">
                    <AccountCell account={account} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-300">
                    {account.latest ? formatCount(account.latest.followers) : <span className="text-zinc-400">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <ScrapeStatus account={account} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost" size="sm" className="h-7 text-xs"
                      disabled={busyId === account.id}
                      onClick={() => setTracking(account, false)}
                    >
                      Stop tracking
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {stopped.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-3">
                <h2 className="font-mono text-xs font-semibold text-zinc-400">Not tracked</h2>
                <div className="h-px flex-1 bg-white/[0.07]" />
                <span className="text-xs tabular-nums text-zinc-400">{stopped.length}</span>
              </div>
              <p className="mb-3 max-w-[65ch] text-sm text-zinc-400">
                Not scraped and costing nothing. Their history is kept and still appears on the
                charts.
              </p>
              <Table>
                <TableBody>
                  {stopped.map((account) => (
                    <TableRow key={account.id} className="hover:bg-white/[0.055]">
                      <TableCell className="max-w-0">
                        <AccountCell account={account} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-300">
                        {account.latest ? formatCount(account.latest.followers) : <span className="text-zinc-400">—</span>}
                      </TableCell>
                      <TableCell className="w-[13rem] text-right">
                        <Button
                          variant="ghost" size="sm" className="h-7 text-xs"
                          disabled={busyId === account.id}
                          onClick={() => setTracking(account, true)}
                        >
                          Resume
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          disabled={busyId === account.id}
                          onClick={() => setPendingDelete(account)}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </>
      )}

      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} onAdd={onAdd} />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the account and every follower reading recorded for it. Those readings
              cannot be collected again — the scrapers only ever return today’s number. If you
              only want to stop the nightly cost, leave it here instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AccountCell({ account }: { account: GrowthAccount }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <PlatformIcon platform={account.platform} />
        <span className="truncate font-medium text-zinc-300">{account.displayName}</span>
      </div>
      <a
        href={account.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-zinc-400 underline-offset-2 transition-colors hover:text-white hover:underline"
      >
        @{account.handle}
        <ExternalLinkIcon className="size-2.5" aria-hidden />
      </a>
    </div>
  );
}
