'use client';

import { useEffect, useRef } from 'react';
import { IconCircleCheck, IconLoader2 } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PANEL } from '../_lib/theme';
import { SHARE_PROBLEM_TEXT, type ScreenShare } from '../_lib/useScreenShare';
import { ShareButton } from './ShareButton';

export type CheckState = { state: 'idle' | 'uploading' | 'passed' | 'failed'; error: string };

interface ScreenCheckProps {
  share: ScreenShare;
  /** Requests the share and runs the check on it. */
  onShare: () => void;
  check: CheckState;
  onRetryCheck: () => void;
  confirmed: boolean;
  onConfirmed: (confirmed: boolean) => void;
}

/**
 * The step before Start: share the whole screen, see it in a preview, and say
 * so. Three things must hold before Start unlocks — the share is live, the
 * check still reached the server (which Start re-verifies), and the candidate
 * has confirmed the preview shows their screen and not only this window, which
 * no automated test can tell for certain (a Mac without permission can share
 * the wallpaper alone).
 */
export function ScreenCheck({ share, onShare, check, onRetryCheck, confirmed, onConfirmed }: ScreenCheckProps) {
  const preview = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    el.srcObject = share.stream;
    if (share.stream) void el.play().catch(() => {});
  }, [share.stream]);

  if (!share.supported) {
    return (
      <p role="alert" className={`${PANEL} max-w-prose rounded-xl px-5 py-4 text-base text-white/85`}>
        {SHARE_PROBLEM_TEXT.unsupported}
      </p>
    );
  }

  return (
    <div className={`${PANEL} max-w-prose rounded-2xl p-5`}>
      <h3 className="text-base font-semibold">Screen check</h3>

      {!share.stream ? (
        <>
          <p className="mt-1 text-sm text-white/75">
            Share your entire screen. Pick the screen you will work on, not a single window or tab.
          </p>
          <ShareButton share={share} onClick={onShare} />
        </>
      ) : (
        <>
          <video
            ref={preview}
            muted
            playsInline
            aria-label="Preview of your shared screen"
            className="mt-3 aspect-video w-full rounded-xl border border-white/[0.10] bg-black object-contain"
          />
          <div className="mt-3 text-sm" role="status">
            {check.state === 'uploading' || check.state === 'idle' ? (
              <p className="flex items-center gap-2 text-white/80">
                <IconLoader2 className="activity-spinner size-4 animate-spin" aria-hidden />
                Checking the recording reaches us…
              </p>
            ) : check.state === 'passed' ? (
              <p className="flex items-center gap-2 text-white">
                <IconCircleCheck className="size-4 text-[#00b8f5]" aria-hidden />
                Your screen is being received.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-red-300">
                  {check.error}
                </p>
                <Button
                  variant="outline"
                  onClick={onRetryCheck}
                  className="h-11 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
          <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-sm text-white/85">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => onConfirmed(v === true)}
              className="mt-0.5 size-5 border-white/30 data-[state=checked]:border-[#00b8f5] data-[state=checked]:bg-[#00b8f5] data-[state=checked]:text-[#04141c]"
            />
            <span>
              The preview shows my whole screen, including windows from other apps, not just this browser window.
            </span>
          </label>
          <button
            type="button"
            onClick={() => share.release()}
            className="mt-2 min-h-11 text-sm text-white/70 underline-offset-4 outline-none hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-[#00b8f5]/60"
          >
            Share a different screen
          </button>
        </>
      )}
    </div>
  );
}
