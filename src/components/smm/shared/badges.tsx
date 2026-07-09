'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SMM_STATUS_QUALIFIED } from '@/types/firestore';
import type { SmmAccountStatus, SmmAdminApproval, SmmNetwork, SmmSubmissionStatus, SmmTier } from '@/types/firestore';

/** Color-coding shared across the SMM tables/cards so each network reads at a glance. */
const NETWORK_STYLES: Record<SmmNetwork, string> = {
  'Inhouse': 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  'X Managed': 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30',
  'Twink': 'bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/30',
  'Other': 'bg-muted text-muted-foreground',
};

export function NetworkBadge({ network }: { network: SmmNetwork }) {
  return <Badge variant="outline" className={cn('font-medium', NETWORK_STYLES[network])}>{network}</Badge>;
}

export function TypeBadges({ type, className }: { type: string[]; className?: string }) {
  if (type.length === 0) return null;
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {type.map((t) => <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>)}
    </span>
  );
}

export function TierBadge({ tier }: { tier: SmmTier }) {
  return (
    <Badge variant="outline" className={cn('font-medium', tier === 1
      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
      : 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/30')}
    >
      Tier {tier}
    </Badge>
  );
}

export function AccountStatusBadge({ status }: { status: SmmAccountStatus }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', status === 'active'
      ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
      : 'bg-muted text-muted-foreground')}
    >
      <span className={cn('size-1.5 rounded-full', status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/50')} />
      {status === 'active' ? 'Active' : 'Inactive'}
    </Badge>
  );
}

const APPROVAL_LABELS: Record<SmmAdminApproval, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function ApprovalBadge({ value }: { value: SmmAdminApproval }) {
  const variantMap: Record<SmmAdminApproval, 'secondary' | 'default' | 'destructive'> = {
    pending: 'secondary',
    approved: 'default',
    rejected: 'destructive',
  };
  return <Badge variant={variantMap[value]}>{APPROVAL_LABELS[value]}</Badge>;
}

/** The status string carries its own emoji (✅/❌) — style only. */
export function SubmissionStatusBadge({ status }: { status: SmmSubmissionStatus }) {
  return (
    <Badge variant="outline" className={cn('font-medium whitespace-nowrap', status === SMM_STATUS_QUALIFIED
      ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
      : 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30')}
    >
      {status}
    </Badge>
  );
}
