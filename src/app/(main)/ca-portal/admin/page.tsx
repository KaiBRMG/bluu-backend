"use client";

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { DisputeTable, type ColumnKey } from '@/components/disputes/DisputeTable';
import { useDisputesData, type AdminFilters } from '@/hooks/useDisputesData';
import type { DisputeDocument, ApprovalStatus } from '@/types/firestore';
import { DeletedUser } from '@/components/DeletedUser';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { currentMonthKey } from '@/lib/salary/salaryDate';

// ─── Column set ───────────────────────────────────────────────────────

const ADMIN_COLUMNS: ColumnKey[] = [
  'saleAmount', 'saleDate', 'fanName', 'creatorName',
  'createdByName', 'assignedToName', 'CaApproval', 'AdminApproval', 'Comment',
];

const ADMIN_CA_APPROVED_COLUMNS: ColumnKey[] = [
  'saleAmount', 'saleDate', 'fanName', 'creatorName',
  'assignedToName', 'CaApproval', 'AdminApproval', 'Comment',
];

// ─── Filter dropdowns ─────────────────────────────────────────────────

function AdminFiltersBar({
  disputes,
  filters,
  onChange,
}: {
  disputes: DisputeDocument[];
  filters: AdminFilters;
  onChange: (f: AdminFilters) => void;
}) {
  const createdByOptions = [
    ...new Map(disputes.map(d => [d.createdBy, d.createdByName])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const assignedToOptions = [
    ...new Map(disputes.map(d => [d.assignedTo, d.assignedToName])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const creatorOptions = [
    ...new Map(disputes.map(d => [d.Creator, d.creatorName])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      <Select
        value={filters.createdBy ?? 'all'}
        onValueChange={v => onChange({ ...filters, createdBy: v === 'all' ? undefined : v })}
      >
        <SelectTrigger size="sm" className="w-44">
          <SelectValue placeholder="Created by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All — created by</SelectItem>
          {createdByOptions.map(([uid, name]) => (
            <SelectItem key={uid} value={uid}>{name || <DeletedUser />}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.assignedTo ?? 'all'}
        onValueChange={v => onChange({ ...filters, assignedTo: v === 'all' ? undefined : v })}
      >
        <SelectTrigger size="sm" className="w-44">
          <SelectValue placeholder="Assigned to" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All — assigned to</SelectItem>
          {assignedToOptions.map(([uid, name]) => (
            <SelectItem key={uid} value={uid}>{name || <DeletedUser />}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.creator ?? 'all'}
        onValueChange={v => onChange({ ...filters, creator: v === 'all' ? undefined : v })}
      >
        <SelectTrigger size="sm" className="w-44">
          <SelectValue placeholder="Creator" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All — creators</SelectItem>
          {creatorOptions.map(([id, name]) => (
            <SelectItem key={id} value={id}>{name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Admin panel ──────────────────────────────────────────────────────

function AdminPanel({
  filter,
  columns = ADMIN_COLUMNS,
  userTimezone,
  showActions,
  resolvedActions,
  groupByCreatedBy,
  refreshKey,
  onAction,
}: {
  filter: string;
  columns?: ColumnKey[];
  userTimezone: string;
  showActions?: boolean;
  resolvedActions?: boolean;
  groupByCreatedBy?: boolean;
  refreshKey: number;
  onAction?: (id: string, action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, reason?: string) => Promise<void>;
}) {
  const { fetchDisputes } = useDisputesData();
  const [disputes, setDisputes] = useState<DisputeDocument[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [adminFilters, setAdminFilters] = useState<AdminFilters>({});

  const load = useCallback(async (p: number, af: AdminFilters) => {
    setLoading(true);
    try {
      const result = await fetchDisputes(filter, p, af);
      setDisputes(result.disputes);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('[AdminPanel] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, fetchDisputes]);

  useEffect(() => {
    load(page, adminFilters);
  }, [page, load, adminFilters, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFiltersChange = (f: AdminFilters) => {
    setAdminFilters(f);
    setPage(1);
  };

  const handlePageChange = (p: number) => setPage(p);

  const handleAction = onAction
    ? async (id: string, action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, reason?: string) => {
        await onAction(id, action, reason);
        load(page, adminFilters);
      }
    : undefined;

  return (
    <div className="pt-3">
      <AdminFiltersBar
        disputes={disputes}
        filters={adminFilters}
        onChange={handleFiltersChange}
      />
      <DisputeTable
        disputes={disputes}
        columns={columns}
        loading={loading}
        page={page}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        userTimezone={userTimezone}
        onAction={showActions ? handleAction : undefined}
        resolvedActions={resolvedActions}
        groupByCreatedBy={groupByCreatedBy}
      />
    </div>
  );
}

// ─── Lazily-loaded tab panels ─────────────────────────────────────────
// Each panel is a substantial tree with its own data fetching, and an admin
// opens one of them at a time. Loading all five on every visit to this page
// would be the single heaviest route in the portal.

function PanelSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-8 w-40 rounded-md" />
      </div>
      <Skeleton className="h-[480px] w-full rounded-xl" />
    </div>
  );
}

const AdminOverview = dynamic(() => import('@/components/ca-admin/AdminOverview'), {
  loading: () => <PanelSkeleton />,
});
const AdminSalaries = dynamic(() => import('@/components/ca-admin/AdminSalaries'), {
  loading: () => <PanelSkeleton />,
});
const AdminSalesData = dynamic(() => import('@/components/ca-admin/AdminSalesData'), {
  loading: () => <PanelSkeleton />,
});
const AdminCoverage = dynamic(() => import('@/components/ca-admin/AdminCoverage'), {
  loading: () => <PanelSkeleton />,
});
const AdminRates = dynamic(() => import('@/components/ca-admin/AdminRates'), {
  loading: () => <PanelSkeleton />,
});

// ─── Page ─────────────────────────────────────────────────────────────

/**
 * CA Admin — everything a CA manager runs that is not the roster itself.
 *
 * The split with Shift Management is by object, not by team: shift CRUD and
 * creator assignment stay there because that page already owns the calendar, the
 * modal and recurrence. Money and the absence pipeline live here.
 *
 * Overview is the default tab: the month read whole — revenue by creator, what
 * payroll cost against it, and anything that needs looking at — before Payroll
 * asks what to pay any one agent. Payroll is the tab with the deadline on it,
 * and it is one click away.
 *
 * The **month is owned here**, shared by Overview and Payroll, because those two
 * are read together and a month that only moved on one of them is how a figure
 * gets quoted from the wrong one (ca-salary.md §10).
 */
export default function CaAdminPage() {
  const { setAdminApproval } = useDisputesData();
  const [refreshKey, setRefreshKey] = useState(0);
  const [month, setMonth] = useState(currentMonthKey());

  const { timezone: userTimezone } = useViewerTimezone();

  const handleAdminAction = async (
    id: string,
    action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>,
    reason?: string,
  ) => {
    await setAdminApproval(id, action, reason);
    setRefreshKey(k => k + 1);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl">
        <h1 className="text-2xl font-bold tracking-tight">CA Admin</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Payroll, sales data, coverage and disputes. Chat Agents should not have access to this page.
        </p>

        <div className="mt-6 rounded-lg border border-border-subtle bg-content-bg">
          <Tabs defaultValue="overview">
            {/* pb-1.5: overflow-x:auto forces overflow-y to auto, so reserve room
                for the trigger focus ring instead of letting it clip. */}
            <div className="overflow-x-auto px-6 pb-1.5 pt-4">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="salaries">Salaries</TabsTrigger>
                <TabsTrigger value="sales">Sales data</TabsTrigger>
                <TabsTrigger value="coverage">Coverage</TabsTrigger>
                <TabsTrigger value="rates">Rates</TabsTrigger>
                <TabsTrigger value="disputes">Disputes</TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-[600px] p-6">
              <TabsContent value="overview">
                <AdminOverview month={month} onMonthChange={setMonth} />
              </TabsContent>
              <TabsContent value="salaries">
                <AdminSalaries month={month} onMonthChange={setMonth} />
              </TabsContent>
              <TabsContent value="sales"><AdminSalesData /></TabsContent>
              <TabsContent value="coverage"><AdminCoverage /></TabsContent>
              <TabsContent value="rates"><AdminRates /></TabsContent>

              <TabsContent value="disputes">
                <h2 className="text-lg font-semibold tracking-tight">Disputes</h2>
                <Tabs defaultValue="all" className="mt-3">
                  <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="unresolved">Unresolved</TabsTrigger>
                    <TabsTrigger value="ca-approved">CA Approved</TabsTrigger>
                    <TabsTrigger value="resolved">Resolved</TabsTrigger>
                  </TabsList>

                  <TabsContent value="all">
                    <AdminPanel
                      filter="admin-all"
                      userTimezone={userTimezone}
                      refreshKey={refreshKey}
                    />
                  </TabsContent>

                  <TabsContent value="unresolved">
                    <AdminPanel
                      filter="admin-unresolved"
                      userTimezone={userTimezone}
                      showActions
                      refreshKey={refreshKey}
                      onAction={handleAdminAction}
                    />
                  </TabsContent>

                  <TabsContent value="ca-approved">
                    <AdminPanel
                      filter="admin-ca-approved"
                      columns={ADMIN_CA_APPROVED_COLUMNS}
                      userTimezone={userTimezone}
                      showActions
                      groupByCreatedBy
                      refreshKey={refreshKey}
                      onAction={handleAdminAction}
                    />
                  </TabsContent>

                  <TabsContent value="resolved">
                    <AdminPanel
                      filter="admin-resolved"
                      userTimezone={userTimezone}
                      showActions
                      resolvedActions
                      refreshKey={refreshKey}
                      onAction={handleAdminAction}
                    />
                  </TabsContent>
                </Tabs>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
