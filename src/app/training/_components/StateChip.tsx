import { IconCheck, IconCircleOff, IconHourglassOff, IconLock, IconPlayerPlay } from '@tabler/icons-react';
import type { TestState } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { STATE_LABEL } from '../_lib/format';
import { AZURE_CHIP } from '../_lib/theme';

const ICON: Record<TestState, typeof IconCheck> = {
  locked: IconLock,
  open: IconPlayerPlay,
  'in-progress': IconPlayerPlay,
  submitted: IconCheck,
  'timed-out': IconHourglassOff,
  missed: IconCircleOff,
};

/** Icon + word, always both — the state is never carried by colour alone. */
export function StateChip({ state, className }: { state: TestState; className?: string }) {
  const Icon = ICON[state];
  const live = state === 'open' || state === 'in-progress';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        live ? AZURE_CHIP : 'border-white/[0.12] bg-white/[0.04] text-white/80',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {STATE_LABEL[state]}
    </span>
  );
}
