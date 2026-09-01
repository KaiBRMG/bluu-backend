'use client';

import { useState } from 'react';
import { promptDeepLink } from '@/lib/promptShareUrl';

/**
 * "Open in Bluu Backend" — the hand-off from the public page back into the app.
 *
 * Shown to **everyone**, unconditionally. There is no reliable way to know from
 * a cold browser whether the visitor has the desktop app, and gating the button
 * on a guess is worse than a click that does nothing: a staff member on a
 * browser we do not recognise would be left with no route into the app at all.
 *
 * ## The note
 *
 * The dialog a browser shows for an unhandled `bluu://` URL is the OS's, not
 * ours — Chrome's "Open Bluu Backend?" and Windows' "You'll need a new app to
 * open this link" are both outside the page and **cannot be styled, worded or
 * suppressed**. What we can control is what the visitor reads when they come
 * back to the tab, so the explanation is revealed by the click rather than
 * standing permanently above it.
 *
 * Revealed on click rather than on a failure heuristic on purpose. Detecting
 * "nothing happened" means racing blur/visibility against a system dialog that
 * behaves differently per OS and browser, and a false positive would tell a
 * staff member with the app installed that they have no access. Someone the
 * link *did* work for is already in the desktop app and never reads it.
 */
export function OpenInApp({ promptId }: { promptId: string }) {
  const [attempted, setAttempted] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <a
        href={promptDeepLink(promptId)}
        onClick={() => setAttempted(true)}
        className="inline-flex w-fit items-center gap-2 rounded-md bg-[#3b82f6] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2563eb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/bluu_uu.svg" alt="" aria-hidden className="size-4" />
        Open in Bluu Backend
      </a>

      {/* `aria-live` so the explanation is announced when it appears — it is the
          answer to an action the user just took, not decoration. */}
      <p aria-live="polite" className="max-w-64 text-right text-[11px] leading-snug text-zinc-500">
        {attempted
          ? 'Nothing opened? Bluu Backend is an internal tool for Bluu Rock members only.'
          : ''}
      </p>
    </div>
  );
}
