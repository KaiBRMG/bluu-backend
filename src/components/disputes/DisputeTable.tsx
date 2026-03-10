'use client';

import { useState } from 'react';
import { EllipsisIcon } from 'lucide-react';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationPrevious, PaginationNext, PaginationLink, PaginationEllipsis,
} from '@/components/ui/pagination';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  HoverCard, HoverCardTrigger, HoverCardContent,
} from '@/components/ui/hover-card';
import type { DisputeDocument, ApprovalStatus } from '@/types/firestore';

// ─── Types ────────────────────────────────────────────────────────────

export type ColumnKey =
  | 'saleAmount'
  | 'saleDate'
  | 'fanName'
  | 'creatorName'
  | 'createdByName'
  | 'assignedToName'
  | 'CaApproval'
  | 'AdminApproval'
  | 'Comment';

const COLUMN_LABELS: Record<ColumnKey, string> = {
  saleAmount: 'Sale Amount',
  saleDate: 'Sale Date',
  fanName: 'Fan Name',
  creatorName: 'Creator',
  createdByName: 'Created By',
  assignedToName: 'Assigned To',
  CaApproval: 'CA Approval',
  AdminApproval: 'Admin Approval',
  Comment: 'Comment',
};

interface DisputeTableProps {
  disputes: DisputeDocument[];
  columns: ColumnKey[];
  loading: boolean;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  userTimezone: string;
  onAction?: (disputeId: string, action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, reason?: string) => void;
  resolvedActions?: boolean;   // admin resolved tab — conditional approve/reject
  groupByCreatedBy?: boolean;  // admin CA Approved tab
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatInUserTz(isoString: string | null, timezone: string): string {
  if (!isoString) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

// ─── ApprovalBadge ────────────────────────────────────────────────────

function ApprovalBadge({ value }: { value: ApprovalStatus }) {
  const variantMap: Record<ApprovalStatus, 'secondary' | 'default' | 'destructive'> = {
    Pending: 'secondary',
    Approved: 'default',
    Rejected: 'destructive',
  };
  return <Badge variant={variantMap[value]}>{value}</Badge>;
}

// ─── UserChip — avatar + display name ────────────────────────────────

function UserChip({ name, photoURL }: { name: string; photoURL: string | null }) {
  if (name === 'No One') return <span className="text-muted-foreground text-sm">No One</span>;
  return (
    <Button variant="outline" className="rounded-full p-0! pe-3! h-8 gap-0 text-sm font-normal">
      <Avatar className="size-7">
        {photoURL && <AvatarImage src={photoURL} alt={name} />}
        <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="pl-1.5">{name}</span>
    </Button>
  );
}

// ─── CommentCell — truncated trigger + hover card with full comment ───

function CommentCell({
  comment,
  createdByName,
  createdByPhotoURL,
}: {
  comment: string;
  createdByName: string;
  createdByPhotoURL: string | null;
}) {
  const preview = comment.length > 15 ? comment.slice(0, 15) + '…' : comment;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="link" className="h-auto p-0 text-sm font-normal text-foreground underline-offset-4">
          {preview}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="flex gap-3">
          <Avatar className="size-9 shrink-0">
            {createdByPhotoURL && <AvatarImage src={createdByPhotoURL} alt={createdByName} />}
            <AvatarFallback className="text-xs">{initials(createdByName)}</AvatarFallback>
          </Avatar>
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold">{createdByName}</p>
            <p className="text-sm break-words">{comment}</p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── ActionPopover ────────────────────────────────────────────────────

function ActionPopover({
  dispute,
  resolvedActions,
  onAction,
}: {
  dispute: DisputeDocument;
  resolvedActions?: boolean;
  onAction: (id: string, action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, reason?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState('');

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setRejectMode(false);
      setReason('');
    }
  };

  const handleApprove = () => {
    setOpen(false);
    onAction(dispute.id, 'Approved');
  };

  const handleRejectConfirm = () => {
    setOpen(false);
    setRejectMode(false);
    onAction(dispute.id, 'Rejected', reason.trim() || undefined);
    setReason('');
  };

  const showApprove = !resolvedActions || dispute.AdminApproval === 'Rejected';
  const showReject = !resolvedActions || dispute.AdminApproval === 'Approved';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="p-1 rounded hover:bg-muted transition-colors"
          aria-label="Actions"
        >
          <EllipsisIcon className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={rejectMode ? 'w-64 p-3' : 'w-36 p-1'}>
        {rejectMode ? (
          <div className="flex flex-col gap-2">
            <Input
              placeholder="Reason (optional)"
              value={reason}
              maxLength={50}
              onChange={e => setReason(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground text-right">{reason.length}/50</p>
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setRejectMode(false); setReason(''); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleRejectConfirm}
              >
                Reject
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {showApprove && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors text-green-700"
                onClick={handleApprove}
              >
                Approve
              </button>
            )}
            {showReject && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors text-red-600"
                onClick={() => setRejectMode(true)}
              >
                Reject
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────

function DisputePagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: (number | 'ellipsis')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('ellipsis');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
  }

  return (
    <Pagination className="mt-4">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            onClick={() => page > 1 && onPageChange(page - 1)}
            aria-disabled={page === 1}
            className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
          />
        </PaginationItem>
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <PaginationItem key={`ell-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink
                isActive={p === page}
                onClick={() => onPageChange(p)}
                className="cursor-pointer"
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          )
        )}
        <PaginationItem>
          <PaginationNext
            onClick={() => page < totalPages && onPageChange(page + 1)}
            aria-disabled={page === totalPages}
            className={page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

// ─── Main component ───────────────────────────────────────────────────

export function DisputeTable({
  disputes,
  columns,
  loading,
  page,
  totalPages,
  onPageChange,
  userTimezone,
  onAction,
  resolvedActions = false,
  groupByCreatedBy = false,
}: DisputeTableProps) {
  const showActions = !!onAction;

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>;
  }

  if (disputes.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">No disputes found.</div>;
  }

  // Move saleDate to the front of the column order
  const orderedColumns: ColumnKey[] = [
    'saleDate',
    ...columns.filter(c => c !== 'saleDate'),
  ];

  const renderRows = () => {
    if (!groupByCreatedBy) {
      return disputes.map(d => (
        <DisputeRow
          key={d.id}
          dispute={d}
          columns={orderedColumns}
          userTimezone={userTimezone}
          showActions={showActions}
          resolvedActions={resolvedActions}
          onAction={onAction}
        />
      ));
    }

    // Group by createdBy
    const groups: { uid: string; name: string; photoURL: string | null; items: DisputeDocument[] }[] = [];
    const seen = new Map<string, DisputeDocument[]>();
    for (const d of disputes) {
      if (!seen.has(d.createdBy)) {
        seen.set(d.createdBy, []);
        groups.push({ uid: d.createdBy, name: d.createdByName, photoURL: d.createdByPhotoURL, items: seen.get(d.createdBy)! });
      }
      seen.get(d.createdBy)!.push(d);
    }

    return groups.flatMap(g => [
      <TableRow key={`group-${g.uid}`} className="bg-muted/30 hover:bg-muted/30">
        <TableCell
          colSpan={orderedColumns.length + (showActions ? 1 : 0)}
          className="py-2 px-2"
        >
          <UserChip name={g.name} photoURL={g.photoURL} />
        </TableCell>
      </TableRow>,
      ...g.items.map(d => (
        <DisputeRow
          key={d.id}
          dispute={d}
          columns={orderedColumns}
          userTimezone={userTimezone}
          showActions={showActions}
          resolvedActions={resolvedActions}
          onAction={onAction}
        />
      )),
    ]);
  };

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            {orderedColumns.map(col => (
              <TableHead key={col}>{COLUMN_LABELS[col]}</TableHead>
            ))}
            {showActions && <TableHead className="w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {renderRows()}
        </TableBody>
      </Table>
      <DisputePagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────

function DisputeRow({
  dispute,
  columns,
  userTimezone,
  showActions,
  resolvedActions,
  onAction,
}: {
  dispute: DisputeDocument;
  columns: ColumnKey[];
  userTimezone: string;
  showActions: boolean;
  resolvedActions: boolean;
  onAction?: (id: string, action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, reason?: string) => void;
}) {
  const cellValue = (col: ColumnKey) => {
    switch (col) {
      case 'saleAmount':
        return `$${dispute.saleAmount.toLocaleString()}`;
      case 'saleDate':
        return <span className="whitespace-nowrap">{formatInUserTz(dispute.saleDate, userTimezone)}</span>;
      case 'fanName':
        return dispute.fanName;
      case 'creatorName':
        return dispute.creatorName;
      case 'createdByName':
        return <UserChip name={dispute.createdByName} photoURL={dispute.createdByPhotoURL} />;
      case 'assignedToName':
        return <UserChip name={dispute.assignedToName} photoURL={dispute.assignedToPhotoURL} />;
      case 'CaApproval':
        return <ApprovalBadge value={dispute.CaApproval} />;
      case 'AdminApproval':
        return <ApprovalBadge value={dispute.AdminApproval} />;
      case 'Comment':
        return (
          <CommentCell
            comment={dispute.Comment}
            createdByName={dispute.createdByName}
            createdByPhotoURL={dispute.createdByPhotoURL}
          />
        );
    }
  };

  return (
    <TableRow>
      {columns.map(col => (
        <TableCell key={col}>{cellValue(col)}</TableCell>
      ))}
      {showActions && (
        <TableCell className="text-right">
          <ActionPopover
            dispute={dispute}
            resolvedActions={resolvedActions}
            onAction={onAction!}
          />
        </TableCell>
      )}
    </TableRow>
  );
}
