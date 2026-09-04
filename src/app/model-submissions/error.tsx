'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { IconAlertTriangle } from '@tabler/icons-react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AZURE, AZURE_INK, PANEL, STAGE_GROUND } from './_lib/theme';

/**
 * Route-level boundary for the public form.
 *
 * Without it, a render crash escaped all the way to `app/global-error.tsx`,
 * which renders an unstyled `NextError` — a stranger part-way through handing us
 * their legal name and photographs was shown a bare "An error occurred", on a
 * page carrying no branding, with no way forward. That is the worst screen in
 * the project to have no design on.
 *
 * `reset()` re-renders this segment in place — no document reload — which is
 * precisely why the page keeps its draft in module scope: the applicant comes
 * back to the step and the answers they had. See `page.tsx`.
 */
export default function ModelSubmissionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Tagged so these separate cleanly from the internal console's noise: this
    // is the unauthenticated public form, and a crash here costs an applicant.
    Sentry.captureException(error, { tags: { area: 'model-submissions' } });
  }, [error]);

  return (
    <main
      translate="no"
      className="notranslate grid min-h-dvh place-items-center px-5 text-white"
      style={STAGE_GROUND}
    >
      <div className="flex w-full max-w-md flex-col items-start gap-6 py-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo/HQ2.webp"
          alt="Bluu Rock"
          width={1374}
          height={868}
          className="h-11 w-auto"
        />

        <div className={cn(PANEL, 'flex w-full flex-col gap-5 rounded-2xl px-6 py-7')}>
          <span
            className="grid size-11 place-items-center rounded-full"
            style={{ backgroundColor: 'rgba(0,184,245,0.12)' }}
            aria-hidden
          >
            <IconAlertTriangle className="size-5" style={{ color: AZURE }} />
          </span>

          <div className="flex flex-col gap-2.5">
            <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
              That didn’t go to plan
            </h1>
            <p className="text-base leading-relaxed text-white/60">
              Something on our side stopped the form. Pick up where you left off — your answers and
              any photos you’ve added are still here.
            </p>
          </div>

          <Button
            type="button"
            onClick={reset}
            className="h-12 w-full rounded-xl text-base font-semibold hover:brightness-110"
            style={{ backgroundColor: AZURE, color: AZURE_INK }}
          >
            <RotateCcw className="size-4" />
            Continue your application
          </Button>
        </div>

        {/* No support handle is hard-coded here on purpose: this link is handed
            out person to person, so whoever sent it is the contact the applicant
            already has, and a stale address would be worse than none. */}
        <p className="text-sm leading-relaxed text-white/45">
          If it keeps happening, reply to whoever sent you this link and we’ll take your application
          from there. Your information stays confidential either way.
        </p>
      </div>
    </main>
  );
}
