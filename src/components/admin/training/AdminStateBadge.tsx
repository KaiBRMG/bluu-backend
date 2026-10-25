import { Badge } from '@/components/ui/badge';
import type { PartState } from '@/lib/training/types';
import { cn } from '@/lib/utils';

const LABEL: Record<PartState, string> = {
  scheduled: 'Scheduled',
  'not-ready': 'Needs images',
  open: 'Not started',
  'in-progress': 'In progress',
  submitted: 'Submitted',
  'timed-out': 'Timed out',
  missed: 'Missed',
};

// Status hues are semantic (DESIGN.md): green = done, blue = live, orange =
// needs a look, red = lost. The word is always there, so none rely on colour.
const TONE: Record<PartState, string> = {
  scheduled: 'border-white/10 bg-white/[0.04] text-zinc-300',
  'not-ready': 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  open: 'border-white/10 bg-white/[0.04] text-zinc-200',
  'in-progress': 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  submitted: 'border-green-400/30 bg-green-400/10 text-green-300',
  'timed-out': 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  missed: 'border-red-400/30 bg-red-400/10 text-red-300',
};

export function AdminStateBadge({ state, className }: { state: PartState; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium', TONE[state], className)}>
      {LABEL[state]}
    </Badge>
  );
}
