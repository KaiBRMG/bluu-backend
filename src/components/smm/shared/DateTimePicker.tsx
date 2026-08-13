'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** `HH:mm` for the native time input. */
function toTimeValue(date: Date | undefined): string {
  return date ? format(date, 'HH:mm') : '';
}

/**
 * Date **and** time picker for scheduled posts. Post times matter to the bonus
 * system — the qualifying windows are measured in hours (3d12h / 5d12h / 7d12h)
 * from the post's timestamp — so the schedule captures a time, not just a day.
 *
 * The calendar keeps whatever time is already set (defaulting to the user's
 * current local time on a fresh pick), and the time field only edits the clock
 * portion. Everything here is local time; callers convert to UTC on save.
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date & time',
  className,
}: {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const pickDay = (day: Date | undefined) => {
    if (!day) {
      onChange(undefined);
      return;
    }
    const now = new Date();
    const next = new Date(day);
    next.setHours(value?.getHours() ?? now.getHours(), value?.getMinutes() ?? now.getMinutes(), 0, 0);
    onChange(next);
    setOpen(false);
  };

  const pickTime = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const next = new Date(value ?? new Date());
    next.setHours(h, m, 0, 0);
    onChange(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('justify-start text-left font-normal', !value && 'text-muted-foreground', className)}
        >
          <CalendarIcon className="size-4" />
          {value ? format(value, 'PPp') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={pickDay} />
        <div className="flex items-center gap-2 border-t p-3">
          <Label htmlFor="post-time" className="text-xs text-muted-foreground">Time</Label>
          <Input
            id="post-time"
            type="time"
            value={toTimeValue(value)}
            onChange={(e) => pickTime(e.target.value)}
            className="h-8 w-32 [color-scheme:dark] tabular-nums"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
