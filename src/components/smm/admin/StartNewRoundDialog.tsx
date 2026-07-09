'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/smm/shared/DatePicker';

/**
 * Start-new-round dialog. Warns that a new round ends the current one (the
 * latest round is always "current"), then collects the round window.
 */
export function StartNewRoundDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (start: string, end: string) => Promise<void>;
}) {
  const [start, setStart] = useState<Date | undefined>(undefined);
  const [end, setEnd] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setStart(undefined); setEnd(undefined); }
  }, [open]);

  const handleStart = async () => {
    if (!start || !end) return;
    if (start >= end) {
      toast.error('Round start must be before end');
      return;
    }
    setSaving(true);
    try {
      await onStart(start.toISOString(), end.toISOString());
      toast.success('New round started');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start round');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a new round</DialogTitle>
          <DialogDescription>
            Starting a new round ends the current one — the newest round becomes active and new
            submissions accumulate against it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Round start</Label>
            <DatePicker value={start} onChange={setStart} className="w-full" />
          </div>
          <div className="space-y-1.5">
            <Label>Round end</Label>
            <DatePicker value={end} onChange={setEnd} className="w-full" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleStart} disabled={!start || !end || saving}>
            {saving ? 'Starting...' : 'Start round'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
