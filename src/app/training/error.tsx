'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@/components/ui/button';
import { AZURE, AZURE_INK, STAGE_GROUND } from './_lib/theme';

/**
 * Route error boundary. Without it a render crash escapes to the app's global
 * error page, which is unstyled — a candidate mid-task would see a bare
 * "An error occurred". The clock is the server's, so reloading loses nothing.
 */
export default function TrainingError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { area: 'training' } });
  }, [error]);

  return (
    <main style={STAGE_GROUND} className="notranslate flex min-h-dvh items-center justify-center px-5 text-white" translate="no">
      <div className="w-full max-w-md text-center">
        <h1 className="text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">Something went wrong</h1>
        <p className="mt-3 text-base text-white/75">
          Your time and your uploads are kept on our side. Reload and you will pick up where you were. If a test was
          running, you will be asked to share your screen again, and the clock keeps running until you do.
        </p>
        <Button
          size="lg"
          className="mt-6 h-12 px-6 text-base font-semibold"
          style={{ backgroundColor: AZURE, color: AZURE_INK }}
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      </div>
    </main>
  );
}
