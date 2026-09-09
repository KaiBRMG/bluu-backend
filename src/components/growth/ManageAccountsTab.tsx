'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLinkIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatCount } from '@/lib/growth/metrics';
import { AccountIdentity, ScrapeStatus } from './growthUi';
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
 * The scrape cadence is stated once, in the page header, rather than repeated
 * here.
 */

interface ManageAccountsTabProps {
  accounts: GrowthAccount[];
  loading: boolean;
  onAdd: (payload: AddGrowthAccountPayload) => Promise<void>;
  onSetTracking: (id: string, isActive: boolean) => Promise<void>;
  onSetTrackPosts: (id: string, trackPosts: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function ManageAccountsTab({
  accounts, loading, onAdd, onSetTracking, onSetTrackPosts, onDelete,
}: ManageAccountsTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GrowthAccount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { active, stopped } = useMemo(() => ({
    active: accounts.filter((a) => a.isActive),
    stopped: accounts.filter((a) => !a.isActive),
  }), [accounts]);

  const setTracking = async (account: GrowthAccount, isActive: boolean) => {
    setBusyId(account.id);
    try {
      await onSetTracking(account.id, isActive);
      toast.success(isActive
        ? `Tracking @${account.handle} again`
        : `Stopped tracking @${account.handle}. Its history is kept.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update that account.');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Post tracking is a second, separate cost per account: the nightly discovery
   * search pays the scraper's 20-result floor for each opted-in handle. The
   * toast says what was armed rather than confirming silently — the discipline
   * this feature runs on is that the person switching it on sees the price.
   */
  const setTrackPosts = async (account: GrowthAccount, trackPosts: boolean) => {
    setBusyId(account.id);
    try {
      await onSetTrackPosts(account.id, trackPosts);
      toast.success(trackPosts
        ? `Finding new posts from @${account.handle} from tonight.`
        : `Stopped finding new posts for @${account.handle}. Posts already tracked keep refreshing.`);
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
      toast.success(`Deleted @${account.handle} and all of its history`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that account.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-4" aria-hidden />
          Track Account
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 rounded-lg" />
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
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
                <TableHead className="w-[8.5rem] text-right">Track posts</TableHead>
                {/* Matches the stopped table's action column so the two line up. */}
                <TableHead className="w-[13rem] text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
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
                    <TrackPostsCell
                      account={account}
                      busy={busyId === account.id}
                      onChange={(next) => setTrackPosts(account, next)}
                    />
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
                {/* Same four columns as the active table, at the same widths, so
                    the two read as one ledger — and named, because a table whose
                    cells have no column headers announces as bare values. */}
                <TableHeader className="sr-only">
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Followers</TableHead>
                    <TableHead>Last read</TableHead>
                    <TableHead className="w-[8.5rem]">Track posts</TableHead>
                    <TableHead className="w-[13rem]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stopped.map((account) => (
                    <TableRow key={account.id} className="hover:bg-white/[0.055]">
                      <TableCell className="max-w-0">
                        <AccountCell account={account} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-300">
                        {account.latest ? formatCount(account.latest.followers) : <span className="text-zinc-400">—</span>}
                      </TableCell>
                      {/* Not `ScrapeStatus`: a stopped account that was never
                          read would claim a "First reading tonight" that is not
                          coming. The last read it did get is still a fact. */}
                      <TableCell className="text-right text-[11px] tabular-nums text-zinc-400">
                        {account.lastScrapeAt
                          ? new Date(account.lastScrapeAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                          : 'Never read'}
                      </TableCell>
                      {/* No toggle on a stopped account: nothing is scraped
                          for it at all, so offering post tracking here would
                          arm a job that cannot run. */}
                      <TableCell className="w-[8.5rem]" />
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
            <AlertDialogTitle>Delete @{pendingDelete?.handle}?</AlertDialogTitle>
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

/**
 * The post-tracking opt-in, and the one warning that belongs beside it.
 *
 * Facebook accounts get a dash rather than a disabled switch: the tweet scraper
 * takes X handles and there is no equivalent actor for page posts here, so this
 * is a capability the platform does not have, not a permission the user lacks.
 * A greyed-out control would suggest it could be turned on.
 *
 * `postsWindowSaturated` means the last discovery came back full of posts under
 * a day old — this account posts faster than one nightly read can see, so posts
 * are being missed. Surfaced here because this is where someone can act on it,
 * and silently missing posts is the problem, not missing them.
 */
function TrackPostsCell({
  account, busy, onChange,
}: {
  account: GrowthAccount;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  if (account.platform !== 'twitter') {
    return (
      <span className="text-[11px] text-zinc-400" title="Post tracking is only available for X accounts">
        —
      </span>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {account.trackPosts && account.postsWindowSaturated && (
        <span
          role="img"
          aria-label={`@${account.handle} posts faster than one nightly read can see, so some posts are being missed`}
          title="Posts faster than one nightly read can see — some posts are being missed"
        >
          <TriangleAlertIcon className="size-3.5 shrink-0 text-orange-400" aria-hidden />
        </span>
      )}
      <Switch
        checked={account.trackPosts}
        disabled={busy}
        onCheckedChange={onChange}
        aria-label={`Track posts for @${account.handle}`}
      />
    </div>
  );
}

function AccountCell({ account }: { account: GrowthAccount }) {
  return (
    // One line, not two: the handle is now the account's only name, so a second
    // line under it would have repeated the first.
    <div className="flex min-w-0 items-center gap-2">
      <AccountIdentity account={account} />
      <a
        href={account.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 items-center gap-1 font-medium text-zinc-300 underline-offset-2 transition-colors hover:text-white hover:underline"
      >
        <span className="truncate">{account.handle}</span>
        <ExternalLinkIcon className="size-2.5 shrink-0" aria-hidden />
      </a>
    </div>
  );
}
