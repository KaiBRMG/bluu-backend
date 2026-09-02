"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { SURFACE, ACCENT_BTN } from "../theme";

/**
 * The state a Firestore listener failure renders.
 *
 * This exists because the alternative is worse than a blank screen: without it,
 * a failed query falls through to the empty branch and the portal tells a
 * creator they have no outstanding work. A permission change, an index rebuild,
 * a dropped connection or an expired token all look identical to "you're all
 * caught up" — so the creator closes the app and misses a deadline nobody knows
 * about. An empty state must only ever be reachable from a *successful* snapshot
 * with zero documents.
 *
 * `onRetry` re-subscribes the listener rather than reloading the page, so a
 * transient failure costs one tap and no lost scroll position.
 */
export function LoadError({
  message = "Couldn't load your requests.",
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-10 text-center ${SURFACE.panel}`}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-zinc-200">{message}</p>
        <p className="text-xs text-zinc-400">
          This is a connection problem, not an empty list — your work is still here.
        </p>
      </div>
      <Button size="sm" onClick={onRetry} className={`h-11 rounded-xl px-5 ${ACCENT_BTN}`}>
        Try again
      </Button>
    </div>
  );
}
