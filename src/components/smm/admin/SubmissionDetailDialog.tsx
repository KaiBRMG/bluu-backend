'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import { ApprovalBadge } from '@/components/smm/shared/badges';
import { SMM_STATUS_LATE, SMM_STATUS_QUALIFIED } from '@/types/firestore';
import type { SmmSubmission, SmmSubmissionStatus } from '@/types/firestore';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5 min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm break-words">{children}</div>
    </div>
  );
}

/**
 * Admin submission detail. Read-only except numLikes, status, bonusAmount,
 * sysComments, and adminApproval (Approve/Reject). userTotals is synced
 * server-side on the approval transition.
 */
export function SubmissionDetailDialog({
  submission,
  open,
  onOpenChange,
  onSave,
}: {
  submission: SmmSubmission | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    submissionId: string,
    updates: Partial<Pick<SmmSubmission, 'numLikes' | 'status' | 'bonusAmount' | 'sysComments' | 'adminApproval'>>,
  ) => Promise<void>;
}) {
  const [numLikes, setNumLikes] = useState('');
  const [bonusAmount, setBonusAmount] = useState('');
  const [status, setStatus] = useState<SmmSubmissionStatus>(SMM_STATUS_QUALIFIED);
  const [sysComments, setSysComments] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!submission || !open) return;
    setNumLikes(String(submission.numLikes));
    setBonusAmount(String(submission.bonusAmount));
    setStatus(submission.status);
    setSysComments(submission.sysComments);
  }, [submission, open]);

  if (!submission) return null;

  const save = async (updates: Parameters<typeof onSave>[1], successMsg: string, closeAfter = false) => {
    setSaving(true);
    try {
      await onSave(submission.id, updates);
      toast.success(successMsg);
      if (closeAfter) onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update submission');
    } finally {
      setSaving(false);
    }
  };

  const saveFields = () =>
    save({
      numLikes: Number(numLikes),
      bonusAmount: Number(bonusAmount),
      status,
      sysComments,
    }, 'Submission updated');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {submission.accountName}
            <ApprovalBadge value={submission.adminApproval} />
            {submission.isResidual && <span className="text-xs text-muted-foreground">(residual)</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Post link">{submission.postLink ? <LinkWithCopy url={submission.postLink} /> : '—'}</Field>
          <Field label="Original link">{submission.originalLink ? <LinkWithCopy url={submission.originalLink} /> : '—'}</Field>
          <Field label="Submitted by">{submission.submittedByName || '—'}</Field>
          <Field label="Screenshot">{submission.screenshotLink ? <LinkWithCopy url={submission.screenshotLink} /> : '—'}</Field>
          <Field label="Post date">{submission.postDate ? format(new Date(submission.postDate), 'PPP') : '—'}</Field>
          <Field label="Submission date">{submission.submissionDate ? format(new Date(submission.submissionDate), 'PPp') : '—'}</Field>
          <Field label="Network">{submission.network}</Field>
          <Field label="Tier">Tier {submission.tier}</Field>
        </div>

        <div className="border-t pt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <div className="space-y-1.5">
            <Label>Likes generated</Label>
            <Input type="number" min={0} value={numLikes} onChange={(e) => setNumLikes(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Bonus amount ($)</Label>
            <Input type="number" min={0} step="0.01" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={status === SMM_STATUS_QUALIFIED ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatus(SMM_STATUS_QUALIFIED)}
              >
                ✅ Qualified
              </Button>
              <Button
                type="button"
                variant={status === SMM_STATUS_LATE ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatus(SMM_STATUS_LATE)}
              >
                ❌ Late
              </Button>
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>System comments</Label>
            <Textarea value={sysComments} onChange={(e) => setSysComments(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 sm:mr-auto">
            <Button
              variant="outline"
              className="text-green-700 border-green-600/40 hover:bg-green-50 dark:hover:bg-green-950"
              disabled={saving || submission.adminApproval === 'approved'}
              onClick={() => save({ adminApproval: 'approved' }, 'Submission approved', true)}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              className="text-red-600 border-red-600/40 hover:bg-red-50 dark:hover:bg-red-950"
              disabled={saving || submission.adminApproval === 'rejected'}
              onClick={() => save({ adminApproval: 'rejected' }, 'Submission rejected', true)}
            >
              Reject
            </Button>
          </div>
          <Button onClick={saveFields} disabled={saving}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
