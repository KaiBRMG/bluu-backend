'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { UserChip } from '@/components/UserChip';
import type { UserTotalRow } from '@/hooks/useSmmBonus';

/** Editable payout cell — commits an absolute override on blur when changed. */
function PayoutCell({
  value,
  onSave,
}: {
  value: number;
  onSave: (amount: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  // Re-sync the draft when the payout changes (effect-free render-phase adjustment).
  const [committed, setCommitted] = useState(value);
  if (committed !== value) {
    setCommitted(value);
    setDraft(value.toFixed(2));
  }

  return (
    <Input
      type="number"
      min={0}
      step="0.01"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => {
        const amount = Number(draft);
        if (Number.isNaN(amount) || amount === value) {
          setDraft(value.toFixed(2));
          return;
        }
        try {
          await onSave(amount);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to update payout');
          setDraft(value.toFixed(2));
        }
      }}
      className="h-8 w-28"
    />
  );
}

/** Current-round earnings — one row per user in userTotals, editable payout. */
export function EarningsTable({
  totals,
  onUpdate,
}: {
  totals: UserTotalRow[];
  onUpdate: (uid: string, amount: number) => Promise<void>;
}) {
  if (totals.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No earnings yet.</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Payout</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {totals.map((t) => (
          <TableRow key={t.uid}>
            <TableCell><UserChip name={t.displayName} photoURL={t.photoURL ?? null} /></TableCell>
            <TableCell>
              <PayoutCell value={t.total} onSave={(amount) => onUpdate(t.uid, amount)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
