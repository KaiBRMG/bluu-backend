"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useBasicUsers } from "@/hooks/useBasicUsers";
import { apiRequest } from "@/lib/clientApi";
import { toast } from "sonner";

// ─── Transfer Dialog ──────────────────────────────────────────────────────────
// Transfers a campaign-tracking entry to another CA-group user. On success the
// entry's `createdBy` changes server-side; live onSnapshot queries update both
// users' dashboards immediately, and the recipient is notified.

interface TransferDialogProps {
  entryId: string;
  onClose: () => void;
  onTransferred?: () => void;
}

export function TransferDialog({ entryId, onClose, onTransferred }: TransferDialogProps) {
  const { user } = useAuth();
  const { users } = useBasicUsers();
  const [selected, setSelected] = useState<{ uid: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const caUsers = useMemo(
    () =>
      users
        .filter(u => !u.isArchived && u.groups.includes("CA") && u.uid !== user?.uid)
        .map(u => ({ uid: u.uid, name: u.displayName || `${u.firstName} ${u.lastName}`.trim() || u.uid }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users, user?.uid]
  );

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await apiRequest(`/api/campaign-tracking/${entryId}/transfer`, {
        method: "POST",
        body: JSON.stringify({ toUid: selected.uid }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Transferred to ${selected.name}`);
      onTransferred?.();
      onClose();
    } catch {
      toast.error("Failed to transfer");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer Entry</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-400">
          You are about to transfer this entry to another user. Please select a user:
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between font-normal">
              <span className={selected ? "" : "text-zinc-500"}>{selected?.name ?? "Select a user..."}</span>
              <ChevronDown className="w-4 h-4 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 overflow-y-auto">
            {caUsers.length === 0 ? (
              <DropdownMenuItem disabled>No users available</DropdownMenuItem>
            ) : (
              caUsers.map(u => (
                <DropdownMenuItem key={u.uid} onClick={() => setSelected(u)}>
                  {u.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!selected || submitting}>
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
// Generic confirm dialog used for archive / unarchive actions.

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title, description, confirmLabel = "Continue", cancelLabel = "Cancel", loading, onConfirm, onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-400">{description}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button onClick={onConfirm} disabled={loading}>{loading ? "Working..." : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const ARCHIVE_CR_TEXT =
  "Customs may be archived if a fan goes silent or if no progress can be made to complete the custom. Customs can be unarchived if needed. Proceed?";
export const UNARCHIVE_CR_TEXT = "This will make the custom active again. Proceed?";
