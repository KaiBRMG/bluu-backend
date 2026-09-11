'use client';

import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { GoLoginOrbitaState } from '@/types/electron';

/**
 * The blocking overlay shown while Orbita is downloading or installing.
 *
 * **Why it blocks.** Orbita is the Chromium build the profiles actually run in,
 * and its version is dictated by each profile's own user agent — so a download
 * can begin in the middle of an ordinary Launch, on a machine that was working
 * fine a minute ago. Several hundred megabytes arrive with the window otherwise
 * looking idle, and every button on it leads somewhere that will fail until the
 * install finishes. Covering the surface is the honest state: there is exactly
 * one thing happening and nothing else to do.
 *
 * It is not a `Dialog`: there is no dismiss, no escape and no outside-click, and
 * a modal that cannot be closed is a screen, not a dialog. Rendered as a sibling
 * overlay inside the window's own `fixed inset-0` ground.
 */
export default function OrbitaGate({ state }: { state: GoLoginOrbitaState }) {
  const { phase, receivedBytes, totalBytes, version } = state;
  const downloading = phase === 'downloading';
  // The CDN does not always send a content-length. An indeterminate bar is
  // honest about that; a fabricated percentage is not.
  const determinate = downloading && totalBytes > 0;
  const percent = determinate ? Math.min(100, (receivedBytes / totalBytes) * 100) : 0;

  return (
    <div
      // The named overlay layer, not a bare `z-50`. It sits at the *same* layer
      // as `CloseGuard` on purpose — both are full-window overlays in one
      // stacking context, so the later sibling in `page.tsx` paints on top, and
      // the close guard is deliberately rendered after this one (an abandoned
      // download can be resumed; an interrupted upload cannot).
      className="absolute inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-background/95 px-8 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-label="Setting up the browser"
    >
      <div className="w-full max-w-md">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400">
          Orbita Browser
        </h2>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">
          {downloading ? 'Downloading' : 'Installing'}
          {version ? <span className="ml-2 font-mono text-base text-zinc-400">v{version}</span> : null}
        </h1>

        <p className="mt-2 text-sm text-zinc-400">
          {downloading
            ? 'GoLogin profiles run in their own browser. This happens once per version and takes a few minutes.'
            : 'Unpacking and verifying. Almost there — do not quit Bluu.'}
        </p>

        <div className="mt-5">
          {determinate ? (
            // The indicator is pinned to Action Blue Deep rather than `--primary`,
            // which renders near-white app-wide (DESIGN.md §2) — the same reason
            // the folder chips carry the hex directly.
            <Progress
              value={percent}
              className="bg-white/[0.08] [&>[data-slot=progress-indicator]]:bg-[#2563eb]"
            />
          ) : (
            // No content-length, or unpacking: there is no percentage to show, so
            // a moving bar would be an invented one. A pulsing rail says "working"
            // without claiming to know how far along it is.
            <div className="h-2 w-full animate-pulse rounded-full bg-white/[0.08]" aria-hidden />
          )}
          <p className="mt-2 flex items-center gap-1.5 text-[11px] tabular-nums text-zinc-400">
            {!determinate && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {determinate
              ? `${formatMb(receivedBytes)} of ${formatMb(totalBytes)} · ${Math.round(percent)}%`
              : downloading
                ? `${formatMb(receivedBytes)} downloaded`
                : 'Working…'}
          </p>
        </div>
      </div>
    </div>
  );
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
