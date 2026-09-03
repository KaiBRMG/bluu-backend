"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { COLOR, SURFACE } from "../theme";

/**
 * Themed shell around shadcn `Dialog` for the creator portal. Gives every detail
 * view Esc-to-close, a focus trap and `role="dialog"` for free — replacing the
 * hand-rolled `createPortal` overlays the portal used to carry. One visual
 * language, one accessible primitive. Never hand-roll an overlay here.
 *
 * The footer is `sticky` to the bottom of the scroll area rather than riding to
 * the end of a long record: on a phone, a custom with a long description used to
 * push its own completion button below the fold, so the primary action of the
 * screen required a scroll to find.
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
          "max-h-[88dvh] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-md",
          className,
        )}
        style={{ color: COLOR.ink }}
      >
        <DialogHeader
          className="sticky top-0 z-10 space-y-0 border-b px-5 py-4"
          style={{ borderColor: COLOR.line, background: COLOR.surface }}
        >
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="text-base font-semibold" style={{ color: COLOR.ink }}>
              {title}
            </DialogTitle>
            {headerExtra}
          </div>
          <DialogDescription className="sr-only">
            {description ?? "Details for this record."}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-5">{children}</div>

        {footer && (
          <DialogFooter
            className="sticky bottom-0 border-t px-5 py-4"
            style={{ borderColor: COLOR.line, background: COLOR.surface }}
          >
            {footer}
          </DialogFooter>
        )}
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
      <p className="mb-1 text-[11px] font-medium" style={{ color: COLOR.ink2 }}>
        {label}
      </p>
      <div className="text-sm" style={{ color: COLOR.ink }}>
        {children}
      </div>
    </div>
  );
}
