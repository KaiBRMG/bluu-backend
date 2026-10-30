'use client';

import { cn } from '@/lib/utils';
import { BROWSER_SURFACE, STAGE_GROUND } from '../_lib/theme';

interface ShellProps {
  children: React.ReactNode;
  /** Right side of the masthead — who is signed in, and (outside the task room) a sign-out. */
  aside?: React.ReactNode;
  /** `narrow` for the gate, `wide` for the task room. */
  width?: 'narrow' | 'default' | 'wide';
  className?: string;
}

const WIDTH = { narrow: 'max-w-md', default: 'max-w-3xl', wide: 'max-w-6xl' } as const;

/**
 * The page frame: the stage ground, the masthead, one column. Selection and the
 * caret take the azure so the browser's own chrome belongs to the page.
 *
 * The masthead is pinned (`h-16`, opaque — content scrolls under it) and shows in
 * the task room too: the logo and who is signed in are then in every frame of the
 * screen recording, wherever the candidate has scrolled. The room's clock band
 * pins directly below it (`Countdown`: `top-16`, `lg:top-24`).
 */
export function Shell({ children, aside, width = 'default', className }: ShellProps) {
  return (
    <main
      style={STAGE_GROUND}
      className={cn('notranslate min-h-dvh text-white', BROWSER_SURFACE)}
      translate="no"
    >
      <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#08090b]">
        <div className={cn('mx-auto flex h-16 w-full items-center justify-between gap-4 px-5 sm:px-8', WIDTH[width])}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/HQ2.webp" alt="Bluu Rock" width={1374} height={868} className="h-8 w-auto shrink-0" />
          {aside}
        </div>
      </header>
      {/* Fills the screen below the masthead, so a page can centre itself in what is left (the gate). */}
      <div className={cn('mx-auto flex min-h-[calc(100dvh-4rem)] w-full flex-col px-5 sm:px-8', WIDTH[width], className)}>
        {children}
      </div>
    </main>
  );
}
