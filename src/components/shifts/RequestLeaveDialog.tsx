'use client';

import { useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useUserData } from '@/hooks/useUserData';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';

/**
 * Requesting time off against one shift occurrence.
 *
 * Shared by the shift calendar and the Time off panel, because two
 * implementations of a form that spends a leave balance is two places for the
 * balance rules to drift. Leave is always attached to a **specific occurrence**
 * rather than a free date range: approving it releases *those* creator accounts
 * on *that* day to the overtime board, and a free-text date would leave an admin
 * matching it back to a roster by hand.
 *
 * The caller owns the submit — it knows which hooks to refetch afterwards.
 */

/** Notice an agent must give. Mirrors `MIN_LEAVE_NOTICE_DAYS` in the leave route, which is the authority. */
export const MIN_LEAVE_NOTICE_DAYS = 4;
export const MIN_LEAVE_NOTICE_MS = MIN_LEAVE_NOTICE_DAYS * 24 * 60 * 60 * 1000;

export interface LeaveTarget {
  shiftId: string;
  occurrenceStart: number;
}

interface RequestLeaveDialogProps {
  /** Null closes the dialog. */
  target: LeaveTarget | null;
  onClose: () => void;
  onSubmit: (leaveType: 'paid' | 'unpaid', reason: string) => Promise<void>;
}

export function RequestLeaveDialog({ target, onClose, onSubmit }: RequestLeaveDialogProps) {
  const { userData } = useUserData();
  const { timezone } = useViewerTimezone();

  const [leaveType, setLeaveType] = useState<'paid' | 'unpaid'>('unpaid');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paidRemaining = userData?.remainingPaidLeave ?? 0;
  const unpaidRemaining = userData?.remainingUnpaidLeave ?? 0;
  const hasPaidLeave = userData?.hasPaidLeave === true;

  const paidAvailable = hasPaidLeave && paidRemaining > 0;
  const unpaidAvailable = unpaidRemaining > 0;
  // Paid leave is approved on its merits, so it needs a stated reason; unpaid
  // does not. The server enforces the same asymmetry.
  const reasonRequired = leaveType === 'paid';
  const canSubmit =
    (leaveType === 'paid' ? paidAvailable : unpaidAvailable) && (!reasonRequired || reason.trim().length >= 3);

  const remainingAfter = (leaveType === 'paid' ? paidRemaining : unpaidRemaining) - 1;

  const formatShiftDate = (ms: number) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(ms));

  function reset() {
    setReason('');
    setError(null);
    setLeaveType('unpaid');
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={open => {
        if (!open) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request time off</DialogTitle>
          <DialogDescription>
            {target && <span className="tabular-nums">{formatShiftDate(target.occurrenceStart)}</span>}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={async event => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            try {
              await onSubmit(leaveType, reason.trim());
              toast.success('Leave requested — an admin will review it');
              onClose();
              reset();
            } catch (err) {
              // The server's message names the rule that was hit — the notice
              // period, a spent balance, a duplicate — so it reaches the user.
              setError(err instanceof Error ? err.message : 'Could not request leave');
            } finally {
              setSaving(false);
            }
          }}
          className="space-y-4"
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Type</legend>
            <RadioGroup value={leaveType} onValueChange={value => setLeaveType(value as 'paid' | 'unpaid')}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-md border border-white/[0.07] p-2.5 transition-colors duration-[120ms]',
                  !unpaidAvailable && 'cursor-not-allowed opacity-50',
                  leaveType === 'unpaid' && unpaidAvailable && 'border-action-blue/40 bg-action-blue/[0.08]',
                )}
              >
                <RadioGroupItem value="unpaid" disabled={!unpaidAvailable} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Unpaid</span>
                  <span className="block text-xs text-zinc-400">
                    {unpaidAvailable ? `${unpaidRemaining} day${unpaidRemaining === 1 ? '' : 's'} left` : 'None left'}
                  </span>
                </span>
              </label>

              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-md border border-white/[0.07] p-2.5 transition-colors duration-[120ms]',
                  !paidAvailable && 'cursor-not-allowed opacity-50',
                  leaveType === 'paid' && paidAvailable && 'border-action-blue/40 bg-action-blue/[0.08]',
                )}
              >
                <RadioGroupItem value="paid" disabled={!paidAvailable} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Paid</span>
                  <span className="block text-xs text-zinc-400">
                    {!hasPaidLeave
                      ? 'Not enabled on your account'
                      : paidRemaining > 0
                        ? `${paidRemaining} day${paidRemaining === 1 ? '' : 's'} left`
                        : 'None left'}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </fieldset>

          {/* The notice period belongs where the decision is made, not only on the
              calendar the agent came from (ca-salary.md §6 states it in both
              places). It is guidance, not a gate — the request still goes through
              and an admin decides, which is the point of not blocking it. */}
          <p className="text-xs text-zinc-400">
            Leave not requested at least {MIN_LEAVE_NOTICE_DAYS} days in advance may be rejected.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="leave-reason">
              Reason{' '}
              {reasonRequired ? (
                <span className="text-zinc-400">(required)</span>
              ) : (
                <span className="text-zinc-400">(optional)</span>
              )}
            </Label>
            <Textarea
              id="leave-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder={reasonRequired ? 'A short note so this can be reviewed' : 'Anything an admin should know'}
            />
          </div>

          {/* Only the balance being spent — naming the other one is how a user
              with no paid leave got told they had ten days of it. */}
          {canSubmit && (
            <p className="text-xs text-zinc-400">
              After this you will have{' '}
              <span className="tabular-nums text-foreground">
                {remainingAfter} day{remainingAfter === 1 ? '' : 's'} of {leaveType} leave
              </span>{' '}
              remaining. Approving it frees your accounts that day for someone else to cover.
            </p>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !canSubmit}>
              {saving && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
              Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
