'use client';

import { format, subMonths } from 'date-fns';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DatePicker } from '@/components/smm/shared/DatePicker';
import { SEGMENT } from '@/components/buddyx/buddyxUi';

/**
 * The period control shared by OnlyFans Analytics and Chatter Analytics: preset
 * segments, then a start and an end day that are always on screen. With a
 * preset selected the two inputs show its range; editing either switches to
 * that custom range, seeded from what was showing, and leaves no segment lit.
 */

/** "October" for 0, "September" for 1 — the month labels the presets carry. */
export function monthName(monthsBack: number, now = new Date()): string {
  return format(subMonths(now, monthsBack), 'MMMM');
}

/** `YYYY-MM-DD` → a local Date at noon, so no timezone shifts it a day. */
export function dayKeyToDate(day: string | null | undefined): Date | undefined {
  return day ? new Date(`${day}T12:00:00`) : undefined;
}

export function PeriodPicker<P extends string>({
  options,
  value,
  onPresetChange,
  from,
  to,
  onRangeChange,
}: {
  options: Array<{ value: P; label: string }>;
  /** The selected preset, or `custom` for a hand-picked range. */
  value: P | 'custom';
  onPresetChange: (preset: P) => void;
  /** The range on display — the preset's own while one is selected. */
  from: Date | undefined;
  to: Date | undefined;
  onRangeChange: (from: Date | undefined, to: Date | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value === 'custom' ? '' : value}
        onValueChange={v => v && onPresetChange(v as P)}
        aria-label="Period"
      >
        {options.map(p => <ToggleGroupItem key={p.value} value={p.value} className={SEGMENT}>{p.label}</ToggleGroupItem>)}
      </ToggleGroup>
      <div className="flex items-center gap-1.5">
        <DatePicker value={from} onChange={d => onRangeChange(d, to)} placeholder="Start date" className="h-8 w-44 text-sm" />
        <span className="text-sm text-zinc-500" aria-hidden>–</span>
        <DatePicker value={to} onChange={d => onRangeChange(from, d)} placeholder="End date" className="h-8 w-44 text-sm" />
      </div>
    </div>
  );
}
