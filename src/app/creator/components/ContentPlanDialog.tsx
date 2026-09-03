"use client";

import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { countdownLabel, type AgendaItem } from "../lib/agenda";
import { COLOR, COMPLETE_BTN, contentTypeBadge, URGENCY } from "../theme";
import { CreatorDialog, Field } from "./CreatorDialog";

/**
 * Detail view for a content-planning item.
 *
 * Completing content planning is routine and reversible, so it is available in
 * one tap from the stream as well as here — the ceremony a custom gets would be
 * friction on a weekly PPV set. Both paths run through the same undoable
 * mutation in `useCreatorWork`.
 */
export function ContentPlanDialog({
  item,
  open,
  onOpenChange,
  onComplete,
  busy = false,
  todayKey,
}: {
  item: AgendaItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  busy?: boolean;
  todayKey: string;
}) {
  const entry = item.content;
  if (!entry) return null;

  const rows = entry.description.filter((r) => r.qty || r.content);
  const urgencyHex = URGENCY[item.urgency].hex;
  const isLate = item.urgency === "late";

  return (
    <CreatorDialog
      description="Content plan details, including what is required, the due date and the option to submit it for review."
      open={open}
      onOpenChange={onOpenChange}
      title={entry.contentSummary || "Content"}
      headerExtra={
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-4 font-medium ${contentTypeBadge(entry.contentType)}`}
        >
          {entry.contentType}
        </span>
      }
      footer={
        onComplete ? (
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
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {item.dueLabel && (
          <div
            className="flex items-baseline justify-between gap-3 rounded-xl px-3 py-2.5"
            style={{ background: isLate ? `${urgencyHex}1a` : COLOR.raised }}
          >
            <span className="text-xs" style={{ color: COLOR.ink2 }}>
              Due
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

        {rows.length > 0 && (
          <Field label="What's needed">
            {/* A quantity list is a list. Marking it up as one means a screen
                reader announces "3 items" rather than reading a run-on line. */}
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {rows.map((r, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  {r.qty && (
                    <span
                      className="pf-mono shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
                      style={{ background: COLOR.raised, color: COLOR.ink }}
                    >
                      {r.qty}
                    </span>
                  )}
                  <span className="leading-relaxed" style={{ color: COLOR.ink2 }}>
                    {r.content}
                  </span>
                </li>
              ))}
            </ul>
          </Field>
        )}

        {entry.comment && (
          <Field label="Note from your manager">
            <p className="leading-relaxed" style={{ color: COLOR.ink2 }}>
              {entry.comment}
            </p>
          </Field>
        )}
      </div>
    </CreatorDialog>
  );
}
