"use client";

import { useState, useCallback, useEffect } from 'react';
import { InfoIcon } from 'lucide-react';
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { DisputeTable, type ColumnKey } from '@/components/disputes/DisputeTable';
import { CreateDisputeDialog } from '@/components/disputes/CreateDisputeDialog';
import { useDisputesData } from '@/hooks/useDisputesData';
import { useUserData } from '@/hooks/useUserData';
import type { DisputeDocument, ApprovalStatus } from '@/types/firestore';

// ─── Column sets ─────────────────────────────────────────────────────

const LEFT_COLUMNS: ColumnKey[] = [
  'saleAmount', 'saleDate', 'fanName', 'creatorName', 'createdByName', 'CaApproval', 'Comment',
];

const RIGHT_COLUMNS: ColumnKey[] = [
  'saleAmount', 'saleDate', 'fanName', 'creatorName', 'CaApproval', 'AdminApproval', 'Comment',
];

// ─── Sub-panel ────────────────────────────────────────────────────────

function DisputePanel({
  filter,
  columns,
  userTimezone,
  onAction,
  refreshKey,
}: {
  filter: string;
  columns: ColumnKey[];
  userTimezone: string;
  onAction?: (id: string, action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, reason?: string) => Promise<void>;
  refreshKey: number;
}) {
  const { fetchDisputes } = useDisputesData();
  const [disputes, setDisputes] = useState<DisputeDocument[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const result = await fetchDisputes(filter, p);
      setDisputes(result.disputes);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('[DisputePanel] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, fetchDisputes]);

  useEffect(() => {
    load(page);
  }, [page, load, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePageChange = (p: number) => setPage(p);

  const handleAction = onAction
    ? async (id: string, action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, reason?: string) => {
        await onAction(id, action, reason);
        load(page);
      }
    : undefined;

  return (
    <DisputeTable
      disputes={disputes}
      columns={columns}
      loading={loading}
      page={page}
      totalPages={totalPages}
      onPageChange={handlePageChange}
      userTimezone={userTimezone}
      onAction={handleAction}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function DisputesPage() {
  const { userData } = useUserData();
  const { creators, caUsers, createDispute, setCaApproval } = useDisputesData();
  const [createOpen, setCreateOpen] = useState(false);
  const [leftRefreshKey, setLeftRefreshKey] = useState(0);
  const [rightRefreshKey, setRightRefreshKey] = useState(0);

  const userTimezone =
    userData?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleCaAction = async (
    id: string,
    action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>,
    reason?: string,
  ) => {
    await setCaApproval(id, action, reason);
    setLeftRefreshKey(k => k + 1);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl">
      <h1 className="text-2xl font-bold tracking-tight mb-2">
          Disputes
        </h1>
        <p className="text-sm text-muted-foreground">
        All sales within your shift time are automatically added to your Earnings Report on
          Infloww. If you would like to dispute a sale because, for example, it was sent after
          your shift, you can dispute it here. See your Earnings Report in Infloww &gt; Analytics
          &gt; Employee Reports &gt; Sales Record.
        </p>
        
        <div className="mb-6" />

        {/* Stacked sections */}
        <div className="flex flex-col gap-10">

          {/* ── Section: Disputes on your sales ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold">Disputes on your sales</h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    <InfoIcon className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Review disputes made by others for sales that are currently assigned to you.
                  Please review each and approve/reject. If approved, this sale will be removed
                  from your earnings report and added to theirs.
                </TooltipContent>
              </Tooltip>
            </div>

            <Tabs defaultValue="unresolved">
              <TabsList>
                <TabsTrigger value="unresolved">Unresolved</TabsTrigger>
                <TabsTrigger value="resolved">Resolved</TabsTrigger>
              </TabsList>

              <TabsContent value="unresolved">
                <DisputePanel
                  filter="assigned-pending"
                  columns={LEFT_COLUMNS}
                  userTimezone={userTimezone}
                  onAction={handleCaAction}
                  refreshKey={leftRefreshKey}
                />
              </TabsContent>

              <TabsContent value="resolved">
                <DisputePanel
                  filter="assigned-resolved"
                  columns={LEFT_COLUMNS}
                  userTimezone={userTimezone}
                  refreshKey={leftRefreshKey}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* ── Section: Your Disputes ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold">Your Disputes</h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    <InfoIcon className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Create and view your own disputes. Disputes must be approved by the CA it is
                  assigned to before it can be added to your Earnings Report.
                </TooltipContent>
              </Tooltip>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => setCreateOpen(true)}
              >
                Create Dispute
              </Button>
            </div>

            <Tabs defaultValue="unresolved">
              <TabsList>
                <TabsTrigger value="unresolved">Unresolved</TabsTrigger>
                <TabsTrigger value="resolved">Resolved</TabsTrigger>
              </TabsList>

              <TabsContent value="unresolved">
                <DisputePanel
                  filter="created-unresolved"
                  columns={RIGHT_COLUMNS}
                  userTimezone={userTimezone}
                  refreshKey={rightRefreshKey}
                />
              </TabsContent>

              <TabsContent value="resolved">
                <DisputePanel
                  filter="created-resolved"
                  columns={RIGHT_COLUMNS}
                  userTimezone={userTimezone}
                  refreshKey={rightRefreshKey}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Create Dispute Dialog */}
        <CreateDisputeDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          creators={creators}
          caUsers={caUsers}
          onSubmit={async (payload) => {
            await createDispute(payload);
            setRightRefreshKey(k => k + 1);
          }}
        />
      </div>
    </AppLayout>
  );
}
