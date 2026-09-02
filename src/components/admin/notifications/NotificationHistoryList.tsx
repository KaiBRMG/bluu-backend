'use client';

import { formatDistanceToNow } from 'date-fns';
import { SendHorizontal } from 'lucide-react';
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
import { notificationTypeBadge } from '@/lib/notificationTypeBadge';
import type { AdminNotificationBatch } from '@/types/firestore';

interface NotificationHistoryListProps {
  batches: AdminNotificationBatch[];
  loading: boolean;
  onSelectBatch: (batch: AdminNotificationBatch) => void;
}

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
            const typeMeta = notificationTypeBadge(batch.type);
            const sentAt = batch.sentAt ? new Date(batch.sentAt as string) : null;

            return (
              <TableRow
                key={batch.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => onSelectBatch(batch)}
              >
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {batch.title}
                    {batch.sentViaTelegram && (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"
                        title="Also sent as a Telegram alert"
                      >
                        <SendHorizontal className="h-3 w-3" />
                        Telegram
                      </span>
                    )}
                  </span>
                </TableCell>
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
