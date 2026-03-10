'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { CreatorDocument } from '@/types/firestore';
import type { CaUser, CreateDisputePayload } from '@/hooks/useDisputesData';

interface CreateDisputeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creators: CreatorDocument[];
  caUsers: CaUser[];
  onSubmit: (payload: CreateDisputePayload) => Promise<void>;
}

const EMPTY_FORM = {
  saleAmount: '',
  Creator: '',
  fanName: '',
  saleDate: undefined as Date | undefined,
  saleTime: '',
  Comment: '',
  assignedTo: '',
};

export function CreateDisputeDialog({
  open,
  onOpenChange,
  creators,
  caUsers,
  onSubmit,
}: CreateDisputeDialogProps) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect user's local timezone for display
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const reset = () => {
    setForm({ ...EMPTY_FORM });
    setError(null);
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) reset();
    onOpenChange(value);
  };

  const handleSubmit = async () => {
    setError(null);

    if (
      !form.saleAmount ||
      !form.Creator ||
      !form.fanName ||
      !form.saleDate ||
      !form.saleTime ||
      !form.Comment ||
      !form.assignedTo
    ) {
      setError('All fields are required.');
      return;
    }

    const amount = parseFloat(form.saleAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Sale amount must be a positive number.');
      return;
    }

    // Combine date + time in the user's local timezone.
    // The resulting ISO string from new Date().toISOString() is always UTC —
    // the server will store this as a Firestore Timestamp (UTC).
    const dateStr = format(form.saleDate, 'yyyy-MM-dd');
    const localDateTimeStr = `${dateStr}T${form.saleTime}:00`;
    // Parse as local time using a Date constructor that respects the local environment
    const saleDateLocal = new Date(localDateTimeStr);
    if (isNaN(saleDateLocal.getTime())) {
      setError('Invalid date or time.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        assignedTo: form.assignedTo,
        Creator: form.Creator,
        saleDate: saleDateLocal.toISOString(),
        saleAmount: amount,
        fanName: form.fanName,
        Comment: form.Comment,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit dispute.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Dispute</DialogTitle>
          <DialogDescription className="text-xs">
            A submission must correspond to an individual sale (1 sale = 1 submission).
            Please head to Infloww &gt; Analytics &gt; Employee Reports &gt; Sales Record and find
            the correct sale and transfer all the corresponding info. Please make sure
            information is 100% accurate!
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Sale Amount */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Sale Amount</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.saleAmount}
              onChange={e => setForm(f => ({ ...f, saleAmount: e.target.value }))}
            />
          </div>

          {/* Creator */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Creator</label>
            <Select value={form.Creator} onValueChange={v => setForm(f => ({ ...f, Creator: v }))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select creator" />
              </SelectTrigger>
              <SelectContent>
                {creators.map(c => (
                  <SelectItem key={c.creatorID} value={c.creatorID}>
                    {c.stageName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Fan Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Fan Name</label>
            <Input
              type="text"
              placeholder="Enter fan name"
              value={form.fanName}
              onChange={e => setForm(f => ({ ...f, fanName: e.target.value }))}
            />
          </div>

          {/* Sale Date + Time */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Sale Date & Time</label>
            <div className="flex gap-2">
              {/* Date picker */}
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="flex-1 justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 size-4 opacity-50" />
                    {form.saleDate ? format(form.saleDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={form.saleDate}
                    onSelect={d => {
                      setForm(f => ({ ...f, saleDate: d }));
                      setCalendarOpen(false);
                    }}
                    disabled={(date) => date > new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* Time input */}
              <Input
                type="time"
                className="w-32"
                value={form.saleTime}
                onChange={e => setForm(f => ({ ...f, saleTime: e.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Please enter the sale in your own timezone.{' '}
              <span className="font-medium">Detected: {localTz}</span>
            </p>
          </div>

          {/* Comment */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Comment</label>
            <Textarea
              placeholder="Add a comment..."
              value={form.Comment}
              onChange={e => setForm(f => ({ ...f, Comment: e.target.value }))}
              rows={3}
            />
          </div>

          {/* Assigned To */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Assigned To</label>
            <Select value={form.assignedTo} onValueChange={v => setForm(f => ({ ...f, assignedTo: v }))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a CA user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="No One">No One</SelectItem>
                {caUsers.map(u => (
                  <SelectItem key={u.uid} value={u.uid}>
                    {u.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
