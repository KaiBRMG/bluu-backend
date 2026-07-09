'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { EllipsisIcon } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/smm/shared/ConfirmDialog';
import { GroupHeaderRow } from '@/components/smm/shared/GroupHeaderRow';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserAvatarLabel } from '@/components/UserAvatarLabel';
import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import { ApprovalBadge, NetworkBadge, SubmissionStatusBadge } from '@/components/smm/shared/badges';
import type { SmmSubmission } from '@/types/firestore';

const COLS = 7;

/** Submissions grouped by submitter, with View / Delete row actions. */
export function SubmissionsTable({
  submissions,
  onView,
  onDelete,
}: {
  submissions: SmmSubmission[];
  onView: (submission: SmmSubmission) => void;
  onDelete: (submission: SmmSubmission) => Promise<void>;
}) {
  const [pendingDelete, setPendingDelete] = useState<SmmSubmission | null>(null);
  // Collapsed submitter groups (uids). Groups are expanded by default.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (uid: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });

  if (submissions.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">No submissions this round.</div>;
  }

  const byUser = new Map<string, SmmSubmission[]>();
  for (const s of submissions) {
    if (!byUser.has(s.submittedBy)) byUser.set(s.submittedBy, []);
    byUser.get(s.submittedBy)!.push(s);
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Submitted</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Network</TableHead>
            <TableHead>Post Link</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Approval</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...byUser.entries()].flatMap(([uid, subs]) => {
            const open = !collapsed.has(uid);
            return [
              <GroupHeaderRow key={`u-${uid}`} open={open} onToggle={() => toggle(uid)} colSpan={COLS}>
                <UserAvatarLabel name={subs[0].submittedByName ?? ''} photoURL={subs[0].submittedByPhotoURL ?? null} size="md" />
                <span className="text-xs text-muted-foreground">
                  {subs.length} submission{subs.length === 1 ? '' : 's'}
                </span>
              </GroupHeaderRow>,
              ...(open ? subs.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap">
                  {s.submissionDate ? format(new Date(s.submissionDate), 'PP') : '—'}
                </TableCell>
                <TableCell className="font-medium">{s.accountName}</TableCell>
                <TableCell><NetworkBadge network={s.network} /></TableCell>
                <TableCell>{s.postLink ? <LinkWithCopy url={s.postLink} className="max-w-40" /> : '—'}</TableCell>
                <TableCell><SubmissionStatusBadge status={s.status} /></TableCell>
                <TableCell><ApprovalBadge value={s.adminApproval} /></TableCell>
                <TableCell className="text-right">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="p-1 rounded hover:bg-muted transition-colors" aria-label="Actions">
                        <EllipsisIcon className="size-4 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-32 p-1">
                      <div className="flex flex-col gap-0.5">
                        <button
                          className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                          onClick={() => onView(s)}
                        >
                          View
                        </button>
                        <button
                          className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors text-red-600"
                          onClick={() => setPendingDelete(s)}
                        >
                          Delete
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </TableCell>
              </TableRow>
              )) : []),
            ];
          })}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this submission?"
        description="This permanently removes the submission. If it was approved, its bonus is subtracted from the user’s payout."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!pendingDelete) return;
          const s = pendingDelete;
          setPendingDelete(null);
          await onDelete(s);
        }}
      />
    </>
  );
}
