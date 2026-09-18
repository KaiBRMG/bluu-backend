'use client';

import { useState, useCallback, useEffect } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DisputeReviewQueue, type DisputeVerdict } from '@/components/disputes/DisputeReviewQueue';
import { DisputeLedger } from '@/components/disputes/DisputeLedger';
import { useDisputesData } from '@/hooks/useDisputesData';
import type { DisputeDocument } from '@/types/firestore';

/**
 * Every dispute the agent can see — the full four-feed workspace.
 *
 * This was `/ca-portal/disputes`. It is a component now because the dashboard's
 * Sale Disputes column absorbed the part of it that has a deadline (the open
 * review queue) and needed somewhere to send *"and the rest"*. Lifting the body
 * out rather than rebuilding it in the dialog is the whole point: the paginated
 * queue, the ledger, the derived stage vocabulary and the reject-in-place bar
 * all keep exactly one implementation.
 *
 * It owns its four feeds and nothing else — no page chrome, no create dialog,
 * no heading. The host supplies those, because the host is sometimes a page and
 * is now usually a dialog.
 */

// ─── Feed ─────────────────────────────────────────────────────────────
// One paginated server filter. Radix unmounts an inactive TabsContent, so a
// feed only ever fetches while its own tab is on screen — four panels, never
// four requests.

function useDisputeFeed(filter: string) {
  const { fetchDisputes } = useDisputesData({ lookups: false });
  const [disputes, setDisputes] = useState<DisputeDocument[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(false);
      try {
        const result = await fetchDisputes(filter, page);
        if (cancelled) return;
        // Ruling on the last row of a page empties it. Step back rather than
        // showing "nothing here" while page 1 is full.
        if (result.disputes.length === 0 && page > 1) {
          setPage(p => Math.min(p - 1, result.totalPages));
          return;
        }
        setDisputes(result.disputes);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      } catch (err) {
        if (cancelled) return;
        console.error('[disputes] load failed:', err);
        setError(true);
      } finally {
        // A superseded response must never land: it would show one filter's
        // rows under another filter's heading.
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [filter, page, nonce, fetchDisputes]);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  return { disputes, page, setPage, total, totalPages, loading, error, reload };
}

// ─── Panels ───────────────────────────────────────────────────────────

function ReviewPanel({
  filter,
  userTimezone,
  emptyLine,
  actionable = false,
  onTotalChange,
  onRuled,
}: {
  filter: string;
  userTimezone: string;
  emptyLine: string;
  /** Only the unresolved list carries verdicts. */
  actionable?: boolean;
  onTotalChange?: (total: number) => void;
  onRuled?: () => void;
}) {
  const { setCaApproval } = useDisputesData({ lookups: false });
  const feed = useDisputeFeed(filter);
  const { total, loading, reload } = feed;

  useEffect(() => {
    if (!loading && onTotalChange) onTotalChange(total);
  }, [total, loading, onTotalChange]);

  const handleAction = useCallback(async (
    id: string,
    verdict: DisputeVerdict,
    reason?: string,
  ) => {
    try {
      await setCaApproval(id, verdict, reason);
      toast.success(verdict === 'Approved' ? 'Dispute approved' : 'Dispute rejected');
      reload();
      onRuled?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update this dispute');
      throw err;
    }
  }, [setCaApproval, reload, onRuled]);

  return (
    <DisputeReviewQueue
      disputes={feed.disputes}
      loading={feed.loading}
      error={feed.error}
      onRetry={feed.reload}
      page={feed.page}
      totalPages={feed.totalPages}
      total={feed.total}
      onPageChange={feed.setPage}
      userTimezone={userTimezone}
      onAction={actionable ? handleAction : undefined}
      emptyLine={emptyLine}
    />
  );
}

function LedgerPanel({
  filter,
  userTimezone,
  emptyLine,
  refreshKey,
}: {
  filter: string;
  userTimezone: string;
  emptyLine: string;
  refreshKey: number;
}) {
  const feed = useDisputeFeed(filter);
  const { reload } = feed;

  // A newly filed dispute lands in the unresolved ledger.
  useEffect(() => {
    if (refreshKey > 0) reload();
  }, [refreshKey, reload]);

  return (
    <DisputeLedger
      disputes={feed.disputes}
      loading={feed.loading}
      error={feed.error}
      onRetry={feed.reload}
      page={feed.page}
      totalPages={feed.totalPages}
      total={feed.total}
      onPageChange={feed.setPage}
      userTimezone={userTimezone}
      emptyLine={emptyLine}
    />
  );
}

// ─── Workspace ────────────────────────────────────────────────────────

export function DisputesWorkspace({
  userTimezone,
  /** Bumped by the host when a dispute is filed, so the ledger re-reads. */
  refreshKey = 0,
  onRuled,
}: {
  userTimezone: string;
  refreshKey?: number;
  /** Fired after a verdict lands, so a host holding its own copy can re-read. */
  onRuled?: () => void;
}) {
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const handleTotalChange = useCallback((total: number) => setReviewCount(total), []);

  return (
    <div>
      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-xs text-zinc-400 transition-colors hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <ChevronRightIcon className="size-3.5 transition-transform duration-[120ms] ease-out group-data-[state=open]:rotate-90" />
          How disputes work
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 max-w-[75ch] text-sm text-pretty text-zinc-400">
          Every sale inside your shift is added to your Earnings Report on Infloww
          automatically. If a sale shouldn&apos;t be yours — it was sent after your shift, for
          example — dispute it here: the chatter it currently sits with reviews it, then an
          admin makes the final call. Approved disputes move the sale off their report and onto
          yours. You&apos;ll find the sale under Infloww &gt; Analytics &gt; Employee Reports &gt;
          Sales Record.
        </CollapsibleContent>
      </Collapsible>

      <div className="mt-6 flex flex-col gap-10">
        {/* ── Needs your review ── */}
        <section className="flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">Needs your review</h3>
              {reviewCount !== null && reviewCount > 0 && (
                <Badge variant="secondary" className="tabular-nums">{reviewCount}</Badge>
              )}
            </div>
            <p className="mt-1 max-w-[75ch] text-sm text-zinc-400">
              Sales assigned to you that someone else has claimed. Approving moves the sale off
              your earnings report and onto theirs.
            </p>
          </div>

          <Tabs defaultValue="unresolved">
            <TabsList>
              <TabsTrigger value="unresolved">Open</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
            </TabsList>

            <TabsContent value="unresolved">
              <ReviewPanel
                filter="assigned-pending"
                userTimezone={userTimezone}
                actionable
                onTotalChange={handleTotalChange}
                onRuled={onRuled}
                emptyLine="Nothing waiting on you."
              />
            </TabsContent>

            <TabsContent value="resolved">
              <ReviewPanel
                filter="assigned-resolved"
                userTimezone={userTimezone}
                emptyLine="No disputes on your sales have been resolved yet."
              />
            </TabsContent>
          </Tabs>
        </section>

        {/* ── Your disputes ── */}
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-lg font-semibold">Your disputes</h3>
            <p className="mt-1 max-w-[75ch] text-sm text-zinc-400">
              Sales you&apos;ve claimed. Each one clears the chatter it was assigned to, then an
              admin, before it reaches your earnings report.
            </p>
          </div>

          <Tabs defaultValue="unresolved">
            <TabsList>
              <TabsTrigger value="unresolved">Open</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
            </TabsList>

            <TabsContent value="unresolved">
              <LedgerPanel
                filter="created-unresolved"
                userTimezone={userTimezone}
                refreshKey={refreshKey}
                emptyLine="You haven't got any open disputes. Found a sale that isn't yours? Start one with New dispute."
              />
            </TabsContent>

            <TabsContent value="resolved">
              <LedgerPanel
                filter="created-resolved"
                userTimezone={userTimezone}
                refreshKey={refreshKey}
                emptyLine="None of your disputes have been resolved yet."
              />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}
