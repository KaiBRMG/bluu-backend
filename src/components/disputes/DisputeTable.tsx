'use client';

import { useMemo, useState } from 'react';
import { EllipsisIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { EllipsisPagination } from '@/components/EllipsisPagination';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  HoverCard, HoverCardTrigger, HoverCardContent,
} from '@/components/ui/hover-card';
import type { DisputeDocument, ApprovalStatus } from '@/types/firestore';
import { DeletedUser } from '@/components/DeletedUser';

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
  /**
   * Adds the leading checkbox column and the bulk bar.
   *
   * Only pass it on a tab where **every** row takes the same two verdicts. The
   * resolved tab does not qualify: there Approve and Reject are offered per row
   * depending on the current outcome, and a bar that applied one verdict to a
   * mixed selection would quietly flip decisions the reviewer never looked at.
   */
  selectable?: boolean;
  /** Required for `selectable` to do anything. Resolves once the write lands. */
  onBulkAction?: (
    disputeIds: string[],
    action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>,
    reason?: string,
  ) => Promise<void>;
}

const REASON_MAX = 50;

/**
 * shadcn's checked state paints `--primary`, which renders near-white in this
 * theme (DESIGN.md §2) — so a checked box reads as "disabled" rather than "on".
 * Selection is exactly what Action Blue is for (the One Voice Rule), and the
 * trailing `!` is needed to beat the primitive's own same-specificity rule.
 */
const SELECT_BOX_CLASS =
  'data-[state=checked]:bg-[#2563eb]! data-[state=checked]:border-[#2563eb]! data-[state=checked]:text-white!';

// ─── Helpers ──────────────────────────────────────────────────────────

import { getAvatarColor, getInitials } from '@/lib/utils/avatar';

function formatInUserTz(isoString: string | null, timezone: string): string {
  if (!isoString) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: safeTimezone(timezone),
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
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

// ─── UserChip — promoted to a shared component ────────────────────────

import { UserChip } from '@/components/UserChip';
import { DisputeCreatorChip } from './disputeUi';
import { safeTimezone } from '@/lib/utils/timezone';

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
          <Avatar className="size-9 shrink-0" style={{ background: getAvatarColor(createdByName) }}>
            {createdByPhotoURL && <AvatarImage src={createdByPhotoURL} alt={createdByName} />}
            <AvatarFallback className="text-xs" style={{ background: getAvatarColor(createdByName), color: '#fff' }}>{getInitials(createdByName)}</AvatarFallback>
          </Avatar>
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold">{createdByName || <DeletedUser />}</p>
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
  selectable = false,
  onBulkAction,
}: DisputeTableProps) {
  const showActions = !!onAction;
  const showSelect = selectable && !!onBulkAction;

  const [picked, setPicked] = useState<string[]>([]);

  const visibleIds = useMemo(() => disputes.map(d => d.id), [disputes]);

  // A page change, a filter change or a reload after a write replaces the rows
  // under the selection. The selection is therefore **derived** against what is
  // on screen rather than pruned in an effect: an id that scrolled out of the
  // result set can never reach a bulk action, and a reviewer can never approve a
  // dispute they cannot see. (Doing this in an effect would also mean a second
  // render pass on every load.)
  const selected = useMemo(() => picked.filter(id => visibleIds.includes(id)), [picked, visibleIds]);

  const toggleOne = (id: string, on: boolean) =>
    setPicked(prev => (on ? [...new Set([...prev, id])] : prev.filter(x => x !== id)));

  const allSelected = visibleIds.length > 0 && selected.length === visibleIds.length;
  const toggleAll = (on: boolean) => setPicked(on ? visibleIds : []);

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

  const renderRow = (d: DisputeDocument) => (
    <DisputeRow
      key={d.id}
      dispute={d}
      columns={orderedColumns}
      userTimezone={userTimezone}
      showActions={showActions}
      resolvedActions={resolvedActions}
      onAction={onAction}
      showSelect={showSelect}
      selected={selected.includes(d.id)}
      onSelectChange={toggleOne}
    />
  );

  const renderRows = () => {
    if (!groupByCreatedBy) {
      return disputes.map(renderRow);
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
          colSpan={orderedColumns.length + (showActions ? 1 : 0) + (showSelect ? 1 : 0)}
          className="py-2 px-2"
        >
          <UserChip name={g.name} photoURL={g.photoURL} />
        </TableCell>
      </TableRow>,
      ...g.items.map(renderRow),
    ]);
  };

  return (
    <div>
      {showSelect && (
        <BulkActionBar
          count={selected.length}
          onClear={() => setPicked([])}
          onRun={async (action, reason) => {
            await onBulkAction!(selected, action, reason);
            setPicked([]);
          }}
        />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {showSelect && (
              <TableHead className="w-8">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={v => toggleAll(v === true)}
                  aria-label={allSelected ? 'Clear selection' : 'Select all disputes on this page'}
                  className={SELECT_BOX_CLASS}
                />
              </TableHead>
            )}
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
      <EllipsisPagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}

// ─── BulkActionBar ────────────────────────────────────────────────────

/**
 * The bar above the table once something is selected.
 *
 * It reserves its own height at zero selection rather than appearing and
 * disappearing: a bar that pushes the whole table down on the first tick moves
 * the row the reviewer was aiming at out from under the cursor.
 *
 * Reject opens its reason field in place, in the same bar — DESIGN.md's decision
 * queue rule ("a destructive verdict opens its reason in place"). `Esc` cancels,
 * `Enter` confirms, and a failed write keeps both the selection and the typed
 * reason so the decision is not lost with it.
 */
function BulkActionBar({
  count,
  onClear,
  onRun,
}: {
  count: number;
  onClear: () => void;
  onRun: (action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, reason?: string) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Nothing selected — the bar holds its space and says how to use it.
  if (count === 0) {
    return (
      <div className="mb-2 flex h-9 items-center text-[11px] text-zinc-400">
        Select disputes to approve or reject them together.
      </div>
    );
  }

  const closeReject = () => {
    setRejecting(false);
    setReason('');
  };

  const run = async (action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, withReason?: string) => {
    setBusy(true);
    try {
      await onRun(action, withReason);
      closeReject();
    } catch {
      // The caller surfaces the failure. Keep the selection and the reason.
    } finally {
      setBusy(false);
    }
  };

  const noun = `${count} ${count === 1 ? 'dispute' : 'disputes'}`;

  return (
    <div className="mb-2 flex min-h-9 flex-wrap items-center gap-2 rounded-lg border border-[#3b82f6]/20 bg-[#3b82f6]/[0.06] px-3 py-1.5">
      <span className="text-sm font-medium text-white tabular-nums">{noun} selected</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        disabled={busy}
        className="h-7 px-2 text-zinc-400 hover:text-white"
      >
        Clear
      </Button>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {rejecting ? (
          <>
            <label htmlFor="bulk-reject-reason" className="sr-only">
              Reason for rejecting {noun}
            </label>
            <Input
              id="bulk-reject-reason"
              autoFocus
              value={reason}
              maxLength={REASON_MAX}
              placeholder="Reason (optional) — every filer sees this"
              onChange={e => setReason(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') closeReject();
                if (e.key === 'Enter' && !busy) run('Rejected', reason.trim() || undefined);
              }}
              className="h-8 w-64"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
              {reason.length}/{REASON_MAX}
            </span>
            <Button size="sm" variant="ghost" onClick={closeReject} disabled={busy} className="text-zinc-400 hover:text-white">
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => run('Rejected', reason.trim() || undefined)}
            >
              {busy ? 'Rejecting…' : `Reject ${count}`}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => run('Approved')}
              className="border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300 dark:bg-green-500/10 dark:hover:bg-green-500/20"
            >
              {busy ? 'Approving…' : `Approve ${count}`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setRejecting(true)}
              aria-expanded={rejecting}
              className="text-red-400 hover:bg-red-500/10 hover:text-red-300 dark:hover:bg-red-500/10"
            >
              Reject
            </Button>
          </>
        )}
      </div>
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
  showSelect,
  selected,
  onSelectChange,
}: {
  dispute: DisputeDocument;
  columns: ColumnKey[];
  userTimezone: string;
  showActions: boolean;
  resolvedActions: boolean;
  onAction?: (id: string, action: Extract<ApprovalStatus, 'Approved' | 'Rejected'>, reason?: string) => void;
  showSelect: boolean;
  selected: boolean;
  onSelectChange: (id: string, on: boolean) => void;
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
        // A creator, not a person — `CreatorChip` via `DisputeCreatorChip`,
        // never `UserChip` (CLAUDE.md rule 7). It also falls back to the shared
        // roster when the server could not resolve the id, which is what stops
        // a sub-account rendering as a raw Firestore auto-id here.
        return <DisputeCreatorChip dispute={dispute} />;
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
    // Two cues for a selected row, never hue alone (WCAG 1.4.11): the checked
    // box and the Action Blue tint. Hover keeps the neutral overlay, so hue is
    // what separates "selected" from "under the cursor".
    <TableRow
      data-state={selected ? 'selected' : undefined}
      className={selected ? 'bg-[#3b82f6]/10 hover:bg-[#3b82f6]/15 data-[state=selected]:bg-[#3b82f6]/10' : undefined}
    >
      {showSelect && (
        <TableCell className="w-8">
          <Checkbox
            checked={selected}
            onCheckedChange={v => onSelectChange(dispute.id, v === true)}
            aria-label={`Select the $${dispute.saleAmount.toLocaleString()} dispute from ${dispute.createdByName || 'a deleted user'}`}
            className={SELECT_BOX_CLASS}
          />
        </TableCell>
      )}
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
