"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SURFACE } from "../theme";

/**
 * Themed shell around shadcn `Dialog` for the creator portal. Gives every
 * detail view Esc-to-close, a focus trap, and `role="dialog"` for free —
 * replacing the hand-rolled `createPortal` overlays. One visual language,
 * one accessible primitive.
 */
export function CreatorDialog({
  open,
  onOpenChange,
  title,
  headerExtra,
  children,
  footer,
  className,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible dialog title (rendered visible unless `headerExtra` supplies its own). */
  title: React.ReactNode;
  /** Optional badges/pills rendered alongside the title row. */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /**
   * What this dialog is, for screen readers. Needed because the visible title is
   * often just an identifier — `CustomRequestDialog` titles itself with the bare
   * CR code, so without this the dialog announces as "CR0042, dialog" and gives
   * no hint that it is a detail view containing a completion action.
   */
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          SURFACE.overlay,
          "max-h-[85dvh] overflow-y-auto text-white sm:max-w-md",
          className,
        )}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <DialogTitle className="text-base text-zinc-100">{title}</DialogTitle>
            {headerExtra}
          </div>
          <DialogDescription className="sr-only">
            {description ?? "Details for this record."}
          </DialogDescription>
        </DialogHeader>
        {children}
        {footer && <DialogFooter className="pt-2">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/** A labelled read-only field used in detail dialogs. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-0.5 text-[11px] uppercase tracking-wider text-zinc-400">{label}</p>
      <div className="text-sm text-zinc-200">{children}</div>
    </div>
  );
}
