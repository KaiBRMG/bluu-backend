'use client';

import { useMemo, useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { GroupHeaderRow } from '@/components/smm/shared/GroupHeaderRow';
import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import { NetworkBadge, TypeBadges, accountDisplayName } from '@/components/smm/shared/badges';
import { UserAvatarLabel } from '@/components/UserAvatarLabel';
import { SMM_NETWORKS } from '@/types/firestore';
import type { SmmAccount, SmmNetwork } from '@/types/firestore';

const COLS = 4;

/**
 * Read-only listing of every account SMMs may copy viral posts from
 * (`isViralBonus`), grouped by network. Small enough to load in one request,
 * so — unlike the admin database — nothing here is lazy.
 */
export function ViralAccountsTable({
  accounts,
  loading,
}: {
  accounts: SmmAccount[];
  loading: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (network: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(network)) next.delete(network); else next.add(network);
    return next;
  });

  const byNetwork = useMemo(() => {
    const map = new Map<SmmNetwork, SmmAccount[]>();
    for (const account of accounts) {
      if (!map.has(account.network)) map.set(account.network, []);
      map.get(account.network)!.push(account);
    }
    return map;
  }, [accounts]);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (accounts.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No viral accounts yet.</p>;
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-40">Account</TableHead>
            <TableHead className="min-w-44">Link</TableHead>
            <TableHead className="min-w-44">Type</TableHead>
            <TableHead className="min-w-40">Assigned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SMM_NETWORKS.flatMap((network) => {
            const group = byNetwork.get(network) ?? [];
            if (group.length === 0) return [];
            const open = !collapsed.has(network);
            return [
              <GroupHeaderRow key={`n-${network}`} open={open} onToggle={() => toggle(network)} colSpan={COLS}>
                <NetworkBadge network={network} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.length} account{group.length === 1 ? '' : 's'}
                </span>
              </GroupHeaderRow>,
              ...(open ? group.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">{accountDisplayName(account)}</TableCell>
                  <TableCell>
                    {account.accountLink
                      ? <LinkWithCopy url={account.accountLink} className="max-w-56" />
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {account.type.length > 0
                      ? <TypeBadges type={account.type} />
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {account.assigned
                      ? <UserAvatarLabel name={account.assignedName ?? ''} photoURL={account.assignedPhotoURL ?? null} size="md" />
                      : <span className="text-muted-foreground">No One</span>}
                  </TableCell>
                </TableRow>
              )) : []),
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}
