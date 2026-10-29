'use client';

import { cn } from '@/lib/utils';
import { BROWSER_SURFACE, STAGE_GROUND } from '../_lib/theme';

interface ShellProps {
  children: React.ReactNode;
  /** Right side of the masthead — usually who is signed in and a sign-out. */
  aside?: React.ReactNode;
  /** `narrow` for the gate, `wide` for the task room. */
  width?: 'narrow' | 'default' | 'wide';
  /** The task room drops the masthead entirely: after Start, only the work. */
  bare?: boolean;
  className?: string;
}

const WIDTH = { narrow: 'max-w-md', default: 'max-w-3xl', wide: 'max-w-6xl' } as const;

/**
 * The page frame: the stage ground, the logo, one column. Selection and the
 * caret take the azure so the browser's own chrome belongs to the page.
 */
export function Shell({ children, aside, width = 'default', bare, className }: ShellProps) {
  return (
    <main
      style={STAGE_GROUND}
      className={cn('notranslate min-h-dvh text-white', BROWSER_SURFACE)}
      translate="no"
    >
      <div className={cn('mx-auto flex min-h-dvh w-full flex-col px-5 sm:px-8', WIDTH[width], className)}>
        {!bare && (
          <header className="flex items-center justify-between gap-4 pt-6 sm:pt-9">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo/HQ2.webp" alt="Bluu Rock" width={1374} height={868} className="h-8 w-auto" />
            {aside}
          </header>
        )}
        {children}
      </div>
    </main>
  );
}
