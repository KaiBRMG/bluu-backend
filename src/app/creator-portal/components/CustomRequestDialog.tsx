"use client";

import { ExternalLink, CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type CampaignEntry,
  type CRPriority,
  STATUS_COLORS,
  PRIORITY_COLORS,
  TYPE_LABELS,
  formatAmount,
  formatDueDate,
} from "@/lib/campaignTracking";
import { CreatorDialog, Field } from "./CreatorDialog";
import { TYPE_META, COMPLETE_BTN, ACCENT_BTN, type CustomType } from "../theme";

/**
 * Single detail view for a custom request (customs / calls / items). Replaces
 * the two hand-rolled overlays (dashboard `CRDetailOverlay`, all-customs
 * `DetailCard`). Used by both the dashboard and the All Custom Requests page.
 */
export function CustomRequestDialog({
  entry,
  open,
  onOpenChange,
  driveLink,
  onComplete,
  onIncomplete,
  busy = false,
}: {
  entry: CampaignEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driveLink?: string | null;
  /** Provided when the entry can be marked complete. */
  onComplete?: () => void;
  /** Provided when a completed entry can be reverted. */
  onIncomplete?: () => void;
  busy?: boolean;
}) {
  const accentHex = TYPE_META[entry.type as CustomType]?.hex ?? TYPE_META.CR.hex;
  const dueLabel = entry.dueDate
    ? `${formatDueDate(entry.dueDate)}${entry.dueDateTimezone ? ` (${entry.dueDateTimezone})` : ""}`
    : null;
  const showUpload = entry.type === "CR" && !!driveLink;

  return (
    <CreatorDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span
          className="rounded-md px-2 py-0.5 font-mono text-xs font-semibold tracking-widest"
          style={{ background: `${accentHex}25`, color: accentHex }}
        >
          {entry.CR}
        </span>
      }
      headerExtra={
        <>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status]}`}
          >
            {entry.status}
          </span>
          {entry.priority && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[entry.priority as CRPriority]}`}
            >
              {entry.priority} Priority
            </span>
          )}
        </>
      }
      footer={
        <div className="flex w-full flex-wrap gap-2">
          {showUpload && (
            <a
              href={driveLink!}
              target="_blank"
              rel="noreferrer"
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${ACCENT_BTN}`}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Upload
            </a>
          )}
          {onIncomplete && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onIncomplete}
              className="flex-1 gap-1.5"
            >
              <Undo2 className="h-3.5 w-3.5" /> Mark Incomplete
            </Button>
          )}
          {onComplete && (
            <Button
              disabled={busy}
              onClick={onComplete}
              className={`group flex-1 gap-1.5 ${COMPLETE_BTN}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:scale-110" />
              {busy ? "Saving…" : "Mark Completed"}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-zinc-500">{TYPE_LABELS[entry.type]}</p>

        <Field label="Fan">
          <p className="font-medium text-zinc-100">{entry.fanName}</p>
          {entry.profileLink && (
            <a
              href={entry.profileLink}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-sky-300 transition-colors hover:text-sky-200"
            >
              View Profile <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </Field>

        {entry.description && (
          <Field label="Description">
            <p className="leading-relaxed text-zinc-300">{entry.description}</p>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {dueLabel && (
            <Field label={entry.type === "Call" ? "Call Time" : "Due Date"}>
              <span className="text-rose-300">{dueLabel}</span>
            </Field>
          )}
          {entry.length && <Field label="Length">{entry.length}</Field>}
          {entry.socialPlatform && <Field label="Platform">{entry.socialPlatform}</Field>}
          {entry.socialUsername && <Field label="Username">@{entry.socialUsername}</Field>}
          {entry.address && (
            <Field label="Address" className="col-span-2">
              {entry.address}
            </Field>
          )}
          <Field label="Total Amount">
            <span className="font-semibold tabular-nums text-zinc-100">
              {formatAmount(entry.totalAmount)}
            </span>
          </Field>
          <Field label="Amount Paid">
            <span className="tabular-nums">{formatAmount(entry.amountPaid)}</span>
          </Field>
        </div>
      </div>
    </CreatorDialog>
  );
}
