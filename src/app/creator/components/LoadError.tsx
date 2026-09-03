"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { COLOR, QUIET_BTN, SURFACE, WARN_HEX } from "../theme";

/**
 * The state a Firestore listener failure renders.
 *
 * This exists because the alternative is worse than a blank screen: without it,
 * a failed query falls through to the empty branch and the portal tells a
 * creator she has no outstanding work. A permission change, an index rebuild, a
 * dropped connection or an expired token all look identical to "you're all
 * caught up" — so she closes the app and misses a deadline nobody knows about.
 * **An empty state must only ever be reachable from a *successful* snapshot with
 * zero documents.**
 *
 * `onRetry` re-subscribes the listener rather than reloading the page, so a
 * transient failure costs one tap and no lost scroll position.
 */
export function LoadError({
  message = "Couldn't load your work.",
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-3 rounded-2xl px-6 py-10 text-center ${SURFACE.panel}`}
    >
      <span
        className="grid size-10 place-items-center rounded-full"
        style={{ background: `${WARN_HEX}1f` }}
      >
        <AlertTriangle className="size-5" style={{ color: WARN_HEX }} aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium" style={{ color: COLOR.ink }}>
          {message}
        </p>
        <p className="mx-auto max-w-[40ch] text-xs leading-relaxed" style={{ color: COLOR.ink2 }}>
          This is a connection problem, not an empty list — your work is still here.
        </p>
      </div>
      <Button
        size="sm"
        onClick={onRetry}
        className={`h-11 rounded-xl px-5 text-xs font-semibold ${QUIET_BTN}`}
      >
        Try again
      </Button>
    </div>
  );
}
