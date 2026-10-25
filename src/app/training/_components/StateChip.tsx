import { IconCheck, IconClock, IconHourglassOff, IconLock, IconPlayerPlay, IconTool } from '@tabler/icons-react';
import type { PartState } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { STATE_LABEL } from '../_lib/format';

const ICON: Record<PartState, typeof IconCheck> = {
  scheduled: IconClock,
  'not-ready': IconTool,
  open: IconPlayerPlay,
  'in-progress': IconPlayerPlay,
  submitted: IconCheck,
  'timed-out': IconHourglassOff,
  missed: IconLock,
};

/** Icon + word, always both — the state is never carried by colour alone. */
export function StateChip({ state, className }: { state: PartState; className?: string }) {
  const Icon = ICON[state];
  const live = state === 'open' || state === 'in-progress';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        live ? 'border-[#00b8f5]/50 bg-[#00b8f5]/10 text-[#7dd8fa]' : 'border-white/[0.12] bg-white/[0.04] text-white/80',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {STATE_LABEL[state]}
    </span>
  );
}
