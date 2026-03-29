'use client';

import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminNotificationBatch } from '@/types/firestore';

interface NotificationHistoryListProps {
  batches: AdminNotificationBatch[];
  loading: boolean;
  onSelectBatch: (batch: AdminNotificationBatch) => void;
}

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  shift:   { label: 'Shift',   className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  alert:   { label: 'Alert',   className: 'bg-red-500/15 text-red-600 border-red-500/30' },
  success: { label: 'Success', className: 'bg-green-500/15 text-green-600 border-green-500/30' },
  action:  { label: 'Action',  className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  system:  { label: 'System',  className: 'bg-muted text-muted-foreground' },
  onboarding: { label: 'Onboarding', className: 'bg-muted text-muted-foreground' },
};

export default function NotificationHistoryList({
  batches,
  loading,
  onSelectBatch,
}: NotificationHistoryListProps) {
  if (loading) {
    return (
      <div className="space-y-2 mt-6">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div
        className="mt-6 rounded-lg p-8 text-center"
        style={{
          background: 'var(--sidebar-background)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <p className="text-sm text-muted-foreground">No notifications sent yet.</p>
      </div>
    );
  }

  return (
    <div
      className="mt-6 rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--border-subtle)' }}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="w-28">Type</TableHead>
            <TableHead className="w-28 text-center">Recipients</TableHead>
            <TableHead className="w-40">Sent By</TableHead>
            <TableHead className="w-36">Sent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map(batch => {
            const typeMeta = TYPE_BADGE[batch.type] ?? TYPE_BADGE['system'];
            const sentAt = batch.sentAt ? new Date(batch.sentAt as string) : null;

            return (
              <TableRow
                key={batch.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => onSelectBatch(batch)}
              >
                <TableCell className="font-medium">{batch.title}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={typeMeta.className}>
                    {typeMeta.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-center text-sm text-muted-foreground">
                  {batch.recipientCount}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {batch.sentByName}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {sentAt
                    ? formatDistanceToNow(sentAt, { addSuffix: true })
                    : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
