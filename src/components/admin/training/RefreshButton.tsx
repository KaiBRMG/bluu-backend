'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Re-reads what is on screen right now. The live polling already keeps a running
 * test fresh; this is for the moment an admin has just been told something changed
 * and does not want to wait for the next beat. The icon spins until the read lands
 * and the figures stay in place meanwhile (stale is not empty).
 */
export default function RefreshButton({ onClick, refreshing, className }: { onClick: () => void; refreshing: boolean; className?: string }) {
  return (
    <Button variant="outline" size="sm" className={className} disabled={refreshing} onClick={onClick}>
      <RefreshCw className={cn('size-4', refreshing && 'activity-spinner animate-spin')} aria-hidden />
      Refresh
    </Button>
  );
}
