"use client";

import { CheckCircle2, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAmount, TYPE_LABELS } from "@/lib/campaignTracking";
import { countdownLabel, type AgendaItem } from "../lib/agenda";
import {
  ACCENT_BTN,
  COLOR,
  COMPLETE_BTN,
  FOCUS_RING,
  PRIORITY_CHIP,
  TYPE_META,
  URGENCY,
  type CustomType,
} from "../theme";
import { CreatorDialog, Field } from "./CreatorDialog";

/**
 * Detail view for a custom request (customs / calls / items).
 *
 * **Completion here is a deliberate two-step and that is the point.** Customs
 * are high-ticket; a stray tap in a list must not be able to submit one. Routine
 * content planning completes in one tap from the stream — the difference in
 * stakes is what the difference in ceremony encodes.
 *
 * The button says **"Submit for review"**, not "Mark Completed". Completing
 * routes the record to *Awaiting Approval*, so the old label named an outcome
 * the system does not produce — it told a creator she was finished when a
 * manager still had to look. This was a documented DESIGN.md defect.
 */
export function CustomRequestDialog({
  item,
  open,
  onOpenChange,
  driveLink,
  onComplete,
  busy = false,
  todayKey,
}: {
  item: AgendaItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driveLink?: string | null;
  /** Provided when the entry can be submitted. */
  onComplete?: () => void;
  busy?: boolean;
  todayKey: string;
}) {
  const entry = item.custom;
  if (!entry) return null;

  const meta = TYPE_META[entry.type as CustomType];
  const showUpload = entry.type === "CR" && !!driveLink;
  const urgencyHex = URGENCY[item.urgency].hex;
  const isLate = item.urgency === "late";

  return (
    <CreatorDialog
      description="Custom request details, including the fan, amount, due date and the option to submit it for review."
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="pf-mono text-sm font-medium" style={{ color: COLOR.azure }}>
          {entry.CR}
        </span>
      }
      headerExtra={
        <>
          <span className="text-sm" style={{ color: COLOR.ink2 }}>
            {meta?.label ?? TYPE_LABELS[entry.type]}
          </span>
          {entry.priority && (
            <span
              className={`ml-auto rounded px-1.5 py-0.5 text-[10px] leading-4 ${PRIORITY_CHIP[entry.priority]}`}
            >
              {entry.priority} priority
            </span>
          )}
        </>
      }
      footer={
        <div className="flex w-full flex-col gap-2">
          {showUpload && (
            <a
              href={driveLink!}
              target="_blank"
              rel="noreferrer"
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors ${ACCENT_BTN} ${FOCUS_RING}`}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" /> Upload to Drive
            </a>
          )}
          {onComplete && (
            <Button
              disabled={busy}
              onClick={onComplete}
              className={`group h-12 w-full gap-1.5 rounded-xl text-sm font-semibold ${COMPLETE_BTN}`}
            >
              <CheckCircle2
                className="size-4 transition-transform motion-safe:group-hover:scale-110"
                aria-hidden="true"
              />
              {busy ? "Submitting…" : "Submit for review"}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* The deadline leads, because it is the fact that decides what she does
            next. It carries the urgency hue AND the word, never hue alone. */}
        {item.dueLabel && (
          <div
            className="flex items-baseline justify-between gap-3 rounded-xl px-3 py-2.5"
            style={{ background: isLate ? `${urgencyHex}1a` : COLOR.raised }}
          >
            <span className="text-xs" style={{ color: COLOR.ink2 }}>
              {entry.type === "Call" ? "Call time" : "Due"}
            </span>
            <span className="flex items-baseline gap-2 text-right">
              <span className="text-sm font-medium" style={{ color: COLOR.ink }}>
                {item.dueLabel}
              </span>
              <span
                className="pf-mono shrink-0 text-[11px] font-medium"
                style={{ color: isLate ? urgencyHex : COLOR.ink2 }}
              >
                {countdownLabel(item, todayKey)}
              </span>
            </span>
          </div>
        )}

        <Field label="Fan">
          <p className="font-medium">{entry.fanName}</p>
          {entry.profileLink && (
            <a
              href={entry.profileLink}
              target="_blank"
              rel="noreferrer"
              className={`mt-1 inline-flex min-h-9 items-center gap-1 rounded text-xs transition-colors ${FOCUS_RING}`}
              style={{ color: COLOR.azureText }}
            >
              View profile <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          )}
        </Field>

        {entry.description && (
          <Field label="What they asked for">
            <p className="leading-relaxed" style={{ color: COLOR.ink2 }}>
              {entry.description}
            </p>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          {entry.length && <Field label="Length">{entry.length}</Field>}
          {entry.socialPlatform && <Field label="Platform">{entry.socialPlatform}</Field>}
          {entry.socialUsername && <Field label="Username">@{entry.socialUsername}</Field>}
          {entry.address && (
            <Field label="Address" className="col-span-2">
              {entry.address}
            </Field>
          )}
          <Field label="Total">
            <span className="pf-mono font-medium">{formatAmount(entry.totalAmount)}</span>
          </Field>
          <Field label="Paid so far">
            <span className="pf-mono" style={{ color: COLOR.ink2 }}>
              {formatAmount(entry.amountPaid)}
            </span>
          </Field>
        </div>

        {meta?.infoText && (
          <div
            className="flex gap-2.5 rounded-xl px-3 py-3"
            style={{ background: COLOR.raised }}
          >
            <Info className="mt-0.5 size-4 shrink-0" style={{ color: COLOR.azure }} aria-hidden="true" />
            <p className="text-xs leading-relaxed" style={{ color: COLOR.ink2 }}>
              {meta.infoText}
            </p>
          </div>
        )}

        <p className="text-[11px] leading-relaxed" style={{ color: COLOR.ink3 }}>
          Amounts here are internal tracking figures for coordination. Your payments are
          governed by your signed management agreement.
        </p>
      </div>
    </CreatorDialog>
  );
}
