'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { IconAlertTriangle } from '@tabler/icons-react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AZURE, AZURE_INK, PANEL, STAGE_GROUND } from '@/app/model-submissions/_lib/theme';

/**
 * Route boundary for the onboarding form. Nothing is lost behind it: every
 * answer is autosaved to the server, and anything not yet acknowledged sits in
 * this browser's pending buffer, which the form re-sends on remount.
 */
export default function JoinError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { area: 'creator-onboarding' } });
  }, [error]);

  return (
    <main translate="no" className="notranslate grid min-h-dvh place-items-center px-5 text-white" style={STAGE_GROUND}>
      <div className="flex w-full max-w-md flex-col items-start gap-6 py-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/HQ2.webp" alt="Bluu Rock" width={1374} height={868} className="h-11 w-auto" />
        <div className={cn(PANEL, 'flex w-full flex-col gap-5 rounded-2xl px-6 py-7')}>
          <span
            className="grid size-11 place-items-center rounded-full"
            style={{ backgroundColor: 'rgba(0,184,245,0.12)' }}
            aria-hidden
          >
            <IconAlertTriangle className="size-5" style={{ color: AZURE }} />
          </span>
          <div className="flex flex-col gap-2.5">
            <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">That didn’t go to plan</h1>
            <p className="text-base leading-relaxed text-white/65">
              Something on our side stopped the page. Your answers are saved — carry on from where you were.
            </p>
          </div>
          <Button
            type="button"
            onClick={reset}
            className="h-12 w-full rounded-xl text-base font-semibold hover:brightness-110"
            style={{ backgroundColor: AZURE, color: AZURE_INK }}
          >
            <RotateCcw className="size-4" />
            Carry on
          </Button>
        </div>
      </div>
    </main>
  );
}
