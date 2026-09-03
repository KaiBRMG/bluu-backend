"use client";

import { Check, ChevronRight } from "lucide-react";
import { formatAmount } from "@/lib/campaignTracking";
import { countdownLabel, type AgendaItem } from "../lib/agenda";
import { COLOR, DONE_HEX, FOCUS_RING, PRIORITY_CHIP, SPINE, URGENCY } from "../theme";
import { SpineNode } from "./Spine";

/**
 * The burn-down measure.
 *
 * A due date tells a creator *when*; this tells her *how much of the window is
 * gone*, which is the thing that actually predicts whether something is about
 * to become a problem. It is driven by `scaleX` rather than `width` because it
 * sits under every row of a live-updating list — see `.pf-runway-fill`.
 *
 * `aria-hidden`, deliberately: the row's countdown text already states the same
 * fact in words, and announcing "73 percent" would be noise, not information.
 */
function Runway({ fraction, hex }: { fraction: number; hex: string }) {
  return (
    <span
      aria-hidden="true"
      className="mt-2 block h-[3px] w-full overflow-hidden rounded-full"
      style={{ background: COLOR.line }}
    >
      <span
        className="pf-runway-fill block h-full w-full origin-left"
        style={{ transform: `scaleX(${fraction})`, background: hex }}
      />
    </span>
  );
}

export function WorkRow({
  item,
  todayKey,
  onOpen,
  onComplete,
  sealing = false,
  busy = false,
  index = 0,
}: {
  item: AgendaItem;
  todayKey: string;
  /** Open the detail dialog. The whole row is this target. */
  onOpen: () => void;
  /** Present only where one-tap completion is right — routine content planning.
   *  Customs are high-ticket and complete deliberately, from the dialog. */
  onComplete?: () => void;
  sealing?: boolean;
  busy?: boolean;
  /** Position within its day group, for the arrival stagger. */
  index?: number;
}) {
  const hex = sealing ? DONE_HEX : URGENCY[item.urgency].hex;
  const countdown = countdownLabel(item, todayKey);
  const isLate = item.urgency === "late" && !sealing;

  return (
    <li
      className={`pf-arrive relative list-none ${sealing ? "pf-recede" : ""}`}
      style={{ animationDelay: sealing ? undefined : `${Math.min(index, 8) * 35}ms` }}
    >
      <div className="flex items-start gap-2 pb-3">
        <span className="shrink-0 pt-3">
          <SpineNode state={sealing ? "done" : item.urgency} sealing={sealing} />
        </span>

        <button
          type="button"
          onClick={onOpen}
          className={`min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left transition-colors ${FOCUS_RING} hover:bg-[#131d27] active:bg-[#1e2934]`}
        >
          <span className="flex items-baseline gap-2">
            <span
              className="min-w-0 flex-1 truncate text-sm font-medium"
              style={{ color: COLOR.ink }}
            >
              {item.title}
            </span>
            {item.amount !== undefined && item.amount > 0 && (
              <span
                className="pf-mono shrink-0 text-sm font-medium"
                style={{ color: COLOR.ink }}
              >
                {formatAmount(item.amount)}
              </span>
            )}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {item.code && (
              <span className="pf-mono text-[11px] font-medium" style={{ color: COLOR.azure }}>
                {item.code}
              </span>
            )}
            <span className="text-[11px]" style={{ color: COLOR.ink2 }}>
              {item.typeLabel}
            </span>
            <span aria-hidden="true" style={{ color: COLOR.ink3 }}>
              ·
            </span>
            {/* The countdown is the accessible statement of what the runway
                shows, so it carries the urgency hue AND the word. */}
            <span
              className={`pf-mono text-[11px] ${isLate ? "font-medium" : ""}`}
              style={{ color: isLate ? hex : COLOR.ink2 }}
            >
              {countdown}
            </span>
            {item.priority === "High" && (
              <span
                className={`rounded px-1.5 py-px text-[10px] leading-4 ${PRIORITY_CHIP.High}`}
              >
                High
              </span>
            )}
            {!onComplete && (
              <ChevronRight
                aria-hidden="true"
                className="ml-auto size-3.5 shrink-0"
                style={{ color: COLOR.ink3 }}
              />
            )}
          </span>

          {item.runway !== null && <Runway fraction={sealing ? 1 : item.runway} hex={hex} />}
        </button>

        {onComplete && (
          <button
            type="button"
            onClick={onComplete}
            disabled={busy || sealing}
            aria-label={`Submit ${item.title} for review`}
            className={`mt-1 grid size-11 shrink-0 place-items-center rounded-xl border transition-colors ${FOCUS_RING} disabled:opacity-60`}
            style={{
              borderColor: sealing ? DONE_HEX : COLOR.line,
              background: sealing ? `${DONE_HEX}26` : "transparent",
              color: sealing ? DONE_HEX : COLOR.ink2,
            }}
          >
            <Check className="size-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </li>
  );
}

/** A row's loading placeholder, shaped to the row above rather than to a
 *  generic block — the node, the two lines and the runway are all where the
 *  real thing will be, so nothing moves when the data lands. */
export function WorkRowSkeleton({ index = 0 }: { index?: number }) {
  return (
    <li className="flex list-none items-start gap-2 pb-3" aria-hidden="true">
      <span
        className="flex shrink-0 items-center justify-center pt-3"
        style={{ width: SPINE.colWidth, height: "2rem" }}
      >
        <span
          className="rounded-full"
          style={{ width: SPINE.node, height: SPINE.node, background: COLOR.line }}
        />
      </span>
      <span className="min-w-0 flex-1 px-3 py-2.5">
        <span
          className="block h-3.5 animate-pulse rounded"
          style={{ width: `${72 - index * 9}%`, background: COLOR.line }}
        />
        <span
          className="mt-2 block h-2.5 w-2/5 animate-pulse rounded"
          style={{ background: COLOR.surface }}
        />
        <span
          className="mt-2 block h-[3px] w-full rounded-full"
          style={{ background: COLOR.surface }}
        />
      </span>
    </li>
  );
}
