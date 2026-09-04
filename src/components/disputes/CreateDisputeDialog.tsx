'use client';

/**
 * File a dispute.
 *
 * The form is split into the two questions a reviewer actually asks — *which
 * sale is this* and *why is it yours* — and every rule is enforced per field,
 * beside the field that broke it. The old single "All fields are required."
 * line made the reader hunt for which one.
 */

import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { CreatorDocument } from '@/types/firestore';
import type { CaUser, CreateDisputePayload } from '@/hooks/useDisputesData';

interface CreateDisputeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creators: CreatorDocument[];
  caUsers: CaUser[];
  onSubmit: (payload: CreateDisputePayload) => Promise<void>;
}

const COMMENT_MAX = 300;

const EMPTY_FORM = {
  saleAmount: '',
  Creator: '',
  fanName: '',
  saleDate: undefined as Date | undefined,
  saleTime: '',
  Comment: '',
  assignedTo: '',
};

type FormState = typeof EMPTY_FORM;
type FieldErrors = Partial<Record<keyof FormState, string>>;

// ─── Field shell ──────────────────────────────────────────────────────

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-zinc-400">{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-pretty text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}

// ─── Dialog ───────────────────────────────────────────────────────────

export function CreateDisputeDialog({
  open,
  onOpenChange,
  creators,
  caUsers,
  onSubmit,
}: CreateDisputeDialogProps) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    // Clearing on edit keeps an error attached to the thing that is still wrong.
    setErrors(e => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const reset = () => {
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setSubmitError(null);
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) reset();
    onOpenChange(value);
  };

  /** Returns the combined sale timestamp when the form is sound, else null. */
  const validate = (): Date | null => {
    const next: FieldErrors = {};

    const amount = parseFloat(form.saleAmount);
    if (!form.saleAmount.trim()) next.saleAmount = 'Enter the sale amount.';
    else if (isNaN(amount) || amount <= 0) next.saleAmount = 'Must be a number greater than zero.';

    if (!form.Creator) next.Creator = 'Pick the creator this sale belongs to.';
    if (!form.fanName.trim()) next.fanName = 'Enter the fan’s name as it appears in Infloww.';
    if (!form.saleDate) next.saleDate = 'Pick the date of the sale.';
    else if (!form.saleTime) next.saleDate = 'Add the time of the sale.';
    if (!form.Comment.trim()) next.Comment = 'Say why this sale should be yours.';
    if (!form.assignedTo) next.assignedTo = 'Choose who the sale currently sits with.';

    let saleDateLocal: Date | null = null;
    if (form.saleDate && form.saleTime) {
      const parsed = new Date(`${format(form.saleDate, 'yyyy-MM-dd')}T${form.saleTime}:00`);
      if (isNaN(parsed.getTime())) next.saleDate = 'That date and time don’t make a real moment.';
      else if (parsed.getTime() > Date.now()) next.saleDate = 'The sale can’t be in the future.';
      else saleDateLocal = parsed;
    }

    setErrors(next);
    return Object.values(next).some(Boolean) ? null : saleDateLocal;
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    const saleDateLocal = validate();
    if (!saleDateLocal) return;

    setSubmitting(true);
    try {
      // Stored as UTC by the server; the operator always types their own tz.
      await onSubmit({
        assignedTo: form.assignedTo,
        Creator: form.Creator,
        saleDate: saleDateLocal.toISOString(),
        saleAmount: parseFloat(form.saleAmount),
        fanName: form.fanName.trim(),
        Comment: form.Comment.trim(),
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit dispute.');
    } finally {
      setSubmitting(false);
    }
  };

  const describedBy = (field: keyof FormState, hasHint = false) =>
    errors[field] ? `${field}-error` : hasHint ? `${field}-hint` : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New dispute</DialogTitle>
          <DialogDescription className="text-pretty">
            One sale per dispute. Copy the details straight from Infloww &gt; Analytics &gt;
            Employee Reports &gt; Sales Record — a reviewer can only match the sale if the numbers
            are exact.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* ── The sale ── */}
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 w-full border-b border-white/[0.07] pb-2 text-xs font-semibold text-white">
              The sale
            </legend>

            <div className="grid grid-cols-2 gap-4">
              <Field id="saleAmount" label="Amount" error={errors.saleAmount}>
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400"
                  >
                    $
                  </span>
                  <Input
                    id="saleAmount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="pl-6 tabular-nums"
                    value={form.saleAmount}
                    aria-invalid={!!errors.saleAmount}
                    aria-describedby={describedBy('saleAmount')}
                    onChange={e => set('saleAmount', e.target.value)}
                  />
                </div>
              </Field>

              <Field id="Creator" label="Creator" error={errors.Creator}>
                <Select value={form.Creator} onValueChange={v => set('Creator', v)}>
                  <SelectTrigger
                    id="Creator"
                    className="w-full"
                    aria-invalid={!!errors.Creator}
                    aria-describedby={describedBy('Creator')}
                  >
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
              </Field>
            </div>

            <Field id="fanName" label="Fan name" error={errors.fanName}>
              <Input
                id="fanName"
                type="text"
                placeholder="As it appears in the Sales Record"
                value={form.fanName}
                aria-invalid={!!errors.fanName}
                aria-describedby={describedBy('fanName')}
                onChange={e => set('fanName', e.target.value)}
              />
            </Field>

            <Field
              id="saleDate"
              label="Date & time of the sale"
              error={errors.saleDate}
              hint={<>Enter it in your own timezone — detected as <span className="text-zinc-300">{localTz}</span>.</>}
            >
              <div className="flex gap-2">
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="saleDate"
                      variant="outline"
                      aria-invalid={!!errors.saleDate}
                      aria-describedby={describedBy('saleDate', true)}
                      className={cn(
                        'flex-1 justify-start text-left font-normal',
                        !form.saleDate && 'text-zinc-400',
                      )}
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
                        set('saleDate', d);
                        setCalendarOpen(false);
                      }}
                      disabled={date => date > new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                <Input
                  type="time"
                  aria-label="Time of the sale"
                  className="w-32 tabular-nums [color-scheme:dark]"
                  value={form.saleTime}
                  aria-invalid={!!errors.saleDate}
                  onChange={e => set('saleTime', e.target.value)}
                />
              </div>
            </Field>
          </fieldset>

          {/* ── The claim ── */}
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 w-full border-b border-white/[0.07] pb-2 text-xs font-semibold text-white">
              The claim
            </legend>

            <Field id="Comment" label="Why is this sale yours?" error={errors.Comment}>
              <Textarea
                id="Comment"
                rows={3}
                maxLength={COMMENT_MAX}
                placeholder="e.g. Sent 20 minutes after my shift ended — I closed the sale earlier in the day."
                value={form.Comment}
                aria-invalid={!!errors.Comment}
                aria-describedby={describedBy('Comment')}
                onChange={e => set('Comment', e.target.value)}
              />
              <p className="text-right text-[11px] tabular-nums text-zinc-400">
                {form.Comment.length}/{COMMENT_MAX}
              </p>
            </Field>

            <Field
              id="assignedTo"
              label="Who has the sale now?"
              error={errors.assignedTo}
              hint="They review it first. Pick “No one” if the sale isn’t assigned — it goes straight to an admin."
            >
              <Select value={form.assignedTo} onValueChange={v => set('assignedTo', v)}>
                <SelectTrigger
                  id="assignedTo"
                  className="w-full"
                  aria-invalid={!!errors.assignedTo}
                  aria-describedby={describedBy('assignedTo', true)}
                >
                  <SelectValue placeholder="Select a chatter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="No One">No one</SelectItem>
                  {caUsers.map(u => (
                    <SelectItem key={u.uid} value={u.uid}>
                      {u.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </fieldset>

          {submitError && (
            <p role="alert" className="text-sm text-red-400">{submitError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting} className="text-zinc-400 hover:text-white">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit dispute'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
