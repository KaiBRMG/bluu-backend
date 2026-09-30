'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Loader } from '@/components/ui/loader';

/** Which wait this is — each has its own truthful second line. */
export type ConnectingStage = 'session' | 'account' | 'profiles';

const STAGE_LINE: Record<ConnectingStage, string> = {
  session: 'Checking your access…',
  account: 'Checking your GoLogin seat…',
  profiles: 'Loading your profiles…',
};

/**
 * Past this, the wait is long enough to deserve its reason. Listing profiles is
 * one GoLogin request per 30 of them, walked one at a time on purpose (a burst
 * would get the API key revoked), so a large workspace genuinely takes a while —
 * and a reader told why waits differently from one who thinks the app hung.
 */
const SLOW_AFTER_MS = 6_000;

/**
 * The window's one loading state, shown until it has something real to render.
 *
 * It replaced three different skeletons (guard, account, list) that flashed
 * one after another over several seconds — a page assembling itself piece by
 * piece while GoLogin answered. The window now renders once, when it is ready.
 *
 * **The GoLogin mark is here on purpose.** The wait is an outside service
 * answering, not Bluu being slow, and the mark says so without a sentence. It is
 * a brand asset, served through the same escape hatch as the sidebar's page icon
 * (`SVG_ICONS` in `PageIcon.tsx`), not an icon-set substitute.
 *
 * `.loader` keeps moving under reduced motion — it is exempted in
 * `globals.css`, because a frozen spinner over a real wait reads as a hung app.
 */
export default function ConnectingScreen({ stage }: { stage: ConnectingStage }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-5 bg-background px-6 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex size-16 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.025]">
        <Image src="/Icons/gologin.svg" alt="GoLogin" width={36} height={36} priority />
      </div>
      <div className="space-y-1.5">
        <p className="text-base font-semibold text-white">Connecting to GoLogin…</p>
        <p className="text-[11px] text-zinc-400">
          {slow && stage === 'profiles'
            ? 'GoLogin sends profiles 30 at a time, so a large workspace takes a moment.'
            : slow
              ? 'GoLogin is taking longer than usual to answer.'
              : STAGE_LINE[stage]}
        </p>
      </div>
      <Loader />
    </div>
  );
}
