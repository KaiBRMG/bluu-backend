'use client';

import { useEffect, useState } from 'react';
import { fmtRemaining } from '../_lib/format';
import { PANEL } from '../_lib/theme';
import type { ScreenShare } from '../_lib/useScreenShare';
import { ShareButton } from './ShareButton';

/**
 * Covers the task room while the screen is not shared — after "Stop sharing",
 * or after a refresh (a share never survives one, and only a click can start
 * another). The clock does not stop: pausing it would make stopping the share
 * a way to buy time. The server refuses edit uploads on its own once no
 * recent segment has arrived, so this is the explanation, not the enforcement.
 */
export function ScreenLock({ share, deadlineMs, now }: { share: ScreenShare; deadlineMs: number; now: () => number }) {
  const [remaining, setRemaining] = useState(() => deadlineMs - now());
  useEffect(() => {
    const id = window.setInterval(() => setRemaining(deadlineMs - now()), 500);
    return () => window.clearInterval(id);
  }, [deadlineMs, now]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="screen-lock-title"
      aria-describedby="screen-lock-body"
      className="fixed inset-0 z-50 grid place-items-center bg-[#08090b]/95 px-5"
    >
      <div className={`${PANEL} w-full max-w-md rounded-2xl p-6`}>
        <h2 id="screen-lock-title" className="text-xl font-semibold">
          Share your screen to continue
        </h2>
        <div id="screen-lock-body" className="mt-2 flex flex-col gap-2 text-base text-white/80">
          <p>Your screen is not being shared, so the test is locked. The clock is still running.</p>
          <p className="text-sm text-white/70">
            If you refreshed the page, share again. Uploads work again a few seconds after the recording resumes.
          </p>
        </div>
        <p className="mt-4 text-sm text-white/70">
          Time left <span className="ml-1 text-2xl font-semibold text-white tabular-nums">{fmtRemaining(remaining)}</span>
        </p>
        <ShareButton share={share} autoFocus onClick={() => void share.request()} className="h-12 w-full text-base" />
      </div>
    </div>
  );
}
