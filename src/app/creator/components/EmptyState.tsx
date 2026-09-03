"use client";

import type { LucideIcon } from "lucide-react";
import { COLOR, DONE_HEX } from "../theme";

/**
 * The portal's empty state.
 *
 * Warmer than the console's single quiet line, because the audience is a
 * creator who has just finished her work rather than an operator scanning a
 * ledger — but still one line and one mark, never an illustration and never a
 * box drawn around a sentence.
 *
 * **"Empty" is two different facts and they must not share copy.** Finishing
 * everything is an achievement; having nothing scheduled is a status. Callers
 * pass the right one; `tone` picks the mark.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  tone = "neutral",
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  /** `done` for "you finished it", `neutral` for "there is nothing here". */
  tone?: "done" | "neutral";
  action?: React.ReactNode;
}) {
  const hex = tone === "done" ? DONE_HEX : COLOR.ink3;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span
        className="grid size-10 place-items-center rounded-full"
        style={{ background: `${hex}1f` }}
      >
        <Icon className="size-5" style={{ color: hex }} aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium" style={{ color: COLOR.ink }}>
          {title}
        </p>
        {body && (
          <p className="mx-auto max-w-[38ch] text-xs leading-relaxed" style={{ color: COLOR.ink2 }}>
            {body}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
