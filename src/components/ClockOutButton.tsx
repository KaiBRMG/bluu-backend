'use client';

import { Button } from '@/components/ui/button';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { useClockOutGuard } from '@/hooks/useClockOutGuard';

/**
 * The Clock Out button. Every place a user can press Clock Out renders this, not
 * a bare `<Button onClick={stopTracking}>`: it owns the guard (the "you still
 * have outstanding tasks" prompt), its dialog, and the busy label, so a surface
 * cannot wire half of it. See documentation/tasks.md → The clock-out prompt.
 */
export function ClockOutButton({
  size,
  stoppingLabel = 'Stopping…',
}: {
  size?: React.ComponentProps<typeof Button>['size'];
  stoppingLabel?: string;
}) {
  const { isLoading } = useTimeTrackingContext();
  const { requestClockOut, checking, dialog } = useClockOutGuard();
  return (
    <>
      <Button onClick={requestClockOut} disabled={isLoading || checking} variant="destructive" size={size}>
        {isLoading ? stoppingLabel : checking ? 'Checking…' : 'Clock Out'}
      </Button>
      {dialog}
    </>
  );
}
