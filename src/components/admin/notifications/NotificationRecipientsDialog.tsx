'use client';

import { useEffect, useState, useRef } from 'react';
import { Check, X, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader } from '@/components/ui/loader';
import { useAuth } from '@/components/AuthProvider';
import { DeletedUser } from '@/components/DeletedUser';
import type { AdminNotificationBatch } from '@/types/firestore';

interface Recipient {
  userId: string;
  displayName: string;
  read: boolean;
  dismissedByUser: boolean;
}

interface NotificationRecipientsDialogProps {
  batch: AdminNotificationBatch | null;
  open: boolean;
  onClose: () => void;
  onDelete: (batchId: string) => Promise<void>;
}

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  shift:   { label: 'Shift',   className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  alert:   { label: 'Alert',   className: 'bg-red-500/15 text-red-600 border-red-500/30' },
  success: { label: 'Success', className: 'bg-green-500/15 text-green-600 border-green-500/30' },
  action:  { label: 'Action',  className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
};

export default function NotificationRecipientsDialog({
  batch,
  open,
  onClose,
  onDelete,
}: NotificationRecipientsDialogProps) {
  const { user } = useAuth();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Track which batchId we've already fetched to avoid redundant calls
  const fetchedBatchId = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !batch || !user) return;
    if (fetchedBatchId.current === batch.id) return;

    async function fetchRecipients() {
      setLoading(true);
      setError(null);
      try {
        const idToken = await user!.getIdToken();
        const res = await fetch(`/api/admin/notifications/${batch!.id}/recipients`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Failed to load recipients (${res.status})`);
        }
        const data = await res.json();
        setRecipients(data.recipients ?? []);
        fetchedBatchId.current = batch!.id;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchRecipients();
  }, [open, batch, user]);

  function resetAndClose() {
    setRecipients([]);
    setError(null);
    setDeleteError(null);
    fetchedBatchId.current = null;
    onClose();
  }

  // Reset when dialog closes
  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      if (deleting) return; // don't close mid-delete
      resetAndClose();
    }
  }

  async function handleUnsend() {
    if (!batch) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(batch.id);
      setDeleting(false);
      resetAndClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to unsend');
      setDeleting(false);
    }
  }

  const readCount = recipients.filter(r => r.read).length;
  const dismissedCount = recipients.filter(r => r.dismissedByUser).length;
  const typeMeta = batch ? (TYPE_BADGE[batch.type] ?? null) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {batch?.title}
            {typeMeta && (
              <Badge variant="outline" className={typeMeta.className}>
                {typeMeta.label}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {batch && (
          <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {batch.message}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-4 text-center">{error}</p>
        ) : (
          <>
            {recipients.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {readCount}/{recipients.length} opened &middot; {dismissedCount} dismissed
              </p>
            )}

            <div className="overflow-y-auto flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="w-20 text-center">Opened</TableHead>
                    <TableHead className="w-28 text-center">Dismissed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                        No recipients found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    recipients.map(r => (
                      <TableRow key={r.userId}>
                        <TableCell className="text-sm">{r.displayName || <DeletedUser />}</TableCell>
                        <TableCell className="text-center">
                          {r.read ? (
                            <Check className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.dismissedByUser ? (
                            <Check className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {batch && (
          <DialogFooter className="flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
            {deleteError ? (
              <p className="text-xs text-destructive">{deleteError}</p>
            ) : (
              <span />
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  <Trash2 className="h-4 w-4" />
                  {deleting ? 'Unsending…' : 'Unsend'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Unsend this notification?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes &ldquo;{batch.title}&rdquo; from every recipient&rsquo;s
                    notification tray. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleUnsend}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    Unsend
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
