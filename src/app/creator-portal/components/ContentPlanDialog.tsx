"use client";

import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreatorDialog, Field } from "./CreatorDialog";
import { contentTypeBadge, contentStatusBadge, COMPLETE_BTN } from "../theme";

export interface ContentPlanDescriptionRow {
  qty: string;
  content: string;
}

export interface ContentPlanEntry {
  id: string;
  contentType: string;
  contentSummary: string;
  description: ContentPlanDescriptionRow[];
  comment: string;
  dueDate: string | null;
  createdAt?: string | null;
  status: "Outstanding" | "Completed";
}

/**
 * Single detail view for a content-planning item. Replaces the hand-rolled
 * `DetailModal` in the content-requests page.
 */
export function ContentPlanDialog({
  entry,
  open,
  onOpenChange,
  onComplete,
  formatDate,
  overdue = false,
  busy = false,
}: {
  entry: ContentPlanEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  /** Date formatter owned by the page (keeps date handling in one place per surface). */
  formatDate: (d: string | null | undefined) => string;
  overdue?: boolean;
  busy?: boolean;
}) {
  const rows = entry.description.filter((r) => r.qty || r.content);

  return (
    <CreatorDialog
      open={open}
      onOpenChange={onOpenChange}
      title={entry.contentSummary}
      headerExtra={
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${contentTypeBadge(entry.contentType)}`}
        >
          {entry.contentType}
        </span>
      }
      footer={
        onComplete ? (
          <Button
            disabled={busy}
            onClick={onComplete}
            className={`group w-full gap-1.5 ${COMPLETE_BTN}`}
          >
            <CheckCircle2 className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:scale-110" />
            {busy ? "Saving…" : "Mark Completed"}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <span
          className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium ${contentStatusBadge(entry.status)}`}
        >
          {entry.status}
        </span>

        {rows.length > 0 && (
          <Field label="Description">
            <div className="flex flex-col gap-0.5">
              {rows.map((r, i) => (
                <p key={i} className="text-zinc-300">
                  <span className="font-medium">{r.qty}</span>
                  {r.qty && r.content ? " × " : ""}
                  {r.content}
                </p>
              ))}
            </div>
          </Field>
        )}

        {entry.comment && (
          <Field label="Comment">
            <p className="leading-relaxed text-zinc-300">{entry.comment}</p>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Due Date">
            <span className={overdue ? "font-medium text-red-300" : "text-zinc-300"}>
              {overdue ? "Overdue · " : ""}
              {formatDate(entry.dueDate)}
            </span>
          </Field>
          {entry.createdAt !== undefined && (
            <Field label="Created">{formatDate(entry.createdAt)}</Field>
          )}
        </div>
      </div>
    </CreatorDialog>
  );
}
