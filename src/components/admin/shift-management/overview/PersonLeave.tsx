'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { LEAVE_ALLOTMENT } from '@/lib/leave/leaveBalance';
import { SURFACE } from '@/lib/surfaces';

/**
 * One person's leave balances — the same write as the Settings view's leave
 * table (`PUT /api/admin/users/{uid}`), for the person already open. Missing
 * fields default to the allotment constants, never a hand-typed number.
 */
export function PersonLeave({ uid }: { uid: string }) {
  const { users, loading, error, updateUser } = useAdminUsers();
  const user = users.find(u => u.uid === uid);
  const savedUnpaid = user?.remainingUnpaidLeave ?? LEAVE_ALLOTMENT.unpaid;
  const savedPaid = user?.remainingPaidLeave ?? LEAVE_ALLOTMENT.paid;

  const [unpaid, setUnpaid] = useState(String(savedUnpaid));
  const [paid, setPaid] = useState(String(savedPaid));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUnpaid(String(savedUnpaid));
    setPaid(String(savedPaid));
  }, [savedUnpaid, savedPaid]);

  if (loading && !user) return <Skeleton className="h-40 w-full max-w-md rounded-xl" />;
  if (error) return <p className="text-sm text-zinc-400">Couldn&apos;t load leave balances: {error}</p>;
  if (!user) return <p className="text-sm text-zinc-400">No record for this person.</p>;

  const valid = (v: string) => /^\d+$/.test(v.trim());
  const dirty = unpaid !== String(savedUnpaid) || paid !== String(savedPaid);
  const canSave = dirty && valid(unpaid) && valid(paid) && !saving;

  const save = async () => {
    setSaving(true);
    try {
      await updateUser(uid, {
        remainingUnpaidLeave: Number(unpaid),
        ...(user.hasPaidLeave ? { remainingPaidLeave: Number(paid) } : {}),
      });
      toast.success(`Leave balance saved for ${user.displayName}`);
    } catch (err) {
      toast.error('Could not save the leave balance', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`max-w-md rounded-xl p-4 ${SURFACE}`}>
      <h3 className="text-sm font-medium">Leave days remaining</h3>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="leave-unpaid" className="mb-1 text-xs text-zinc-400">Unpaid</Label>
          <Input
            id="leave-unpaid"
            type="number"
            inputMode="numeric"
            min={0}
            className="form-input h-9 tabular-nums"
            aria-invalid={!valid(unpaid)}
            value={unpaid}
            onChange={e => setUnpaid(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="leave-paid" className="mb-1 text-xs text-zinc-400">Paid</Label>
          <Input
            id="leave-paid"
            type="number"
            inputMode="numeric"
            min={0}
            className="form-input h-9 tabular-nums"
            aria-invalid={!valid(paid)}
            value={paid}
            onChange={e => setPaid(e.target.value)}
            disabled={!user.hasPaidLeave}
          />
        </div>
      </div>

      {!user.hasPaidLeave && (
        <p className="mt-2 text-[11px] text-zinc-400">
          Paid leave is off for this person. Turn it on in{' '}
          <Link href="/admin-portal/user-management" prefetch={false} className="text-zinc-200 underline-offset-2 hover:underline">
            Employee Registry
          </Link>
          .
        </p>
      )}

      {dirty && (
        <div className="mt-4 flex justify-end gap-2 border-t border-white/[0.07] pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setUnpaid(String(savedUnpaid)); setPaid(String(savedPaid)); }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}
