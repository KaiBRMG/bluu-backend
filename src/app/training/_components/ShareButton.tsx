'use client';

import { IconLoader2, IconScreenShare } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AZURE, AZURE_INK } from '../_lib/theme';
import { SHARE_PROBLEM_TEXT, type ScreenShare } from '../_lib/useScreenShare';

/**
 * "Share your screen", with what went wrong last time above it — the one way a
 * share is started, from the screen check and from the lock alike.
 */
export function ShareButton({
  share,
  onClick,
  className,
  autoFocus,
}: {
  share: ScreenShare;
  onClick: () => void;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <>
      {share.problem && (
        <p role="alert" className="mt-4 text-sm text-red-300">
          {SHARE_PROBLEM_TEXT[share.problem]}
        </p>
      )}
      <Button
        autoFocus={autoFocus}
        onClick={onClick}
        disabled={share.busy}
        className={cn('mt-4 h-11 px-5 font-semibold', className)}
        style={{ backgroundColor: AZURE, color: AZURE_INK }}
      >
        {share.busy ? (
          <IconLoader2 className="activity-spinner size-4 animate-spin" aria-hidden />
        ) : (
          <IconScreenShare className="size-4" aria-hidden />
        )}
        Share your screen
      </Button>
    </>
  );
}
