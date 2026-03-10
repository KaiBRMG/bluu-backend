"use client";

import { useState, useCallback, useEffect } from 'react';
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { DisputeTable, type ColumnKey } from '@/components/disputes/DisputeTable';
import { useDisputesData, type AdminFilters } from '@/hooks/useDisputesData';
import { useUserData } from '@/hooks/useUserData';
import type { DisputeDocument, ApprovalStatus } from '@/types/firestore';

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
            <SelectItem key={uid} value={uid}>{name}</SelectItem>
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
            <SelectItem key={uid} value={uid}>{name}</SelectItem>
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

// ─── Page ─────────────────────────────────────────────────────────────

export default function CaAdminPage() {
  const { userData } = useUserData();
  const { setAdminApproval } = useDisputesData();
  const [refreshKey, setRefreshKey] = useState(0);

  const userTimezone =
    userData?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

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
        <h1 className="text-2xl font-bold tracking-tight mb-2">CA Admin</h1>

        <h2 className="text-lg font-semibold mb-3">Disputes</h2>

        <Tabs defaultValue="all">
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
      </div>
    </AppLayout>
  );
}
